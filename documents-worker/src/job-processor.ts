/**
 * Job Processor - Parse -> Chunk -> Embed pipeline
 *
 * Uses quality gates to detect extraction issues.
 * Separates status (operational state) from errorCode (failure reason).
 */

import { downloadFromR2 } from './r2.js'
import { parseDocument, isSupported } from './parser-router.js'
import { chunkPagesWithProvenance } from './chunker.js'
import { generateEmbeddingsBatched } from './embed.js'
import { checkExtractionQuality, classifyError, type ErrorCode } from './quality-gates.js'
import {
  updateJobStatus,
  updateJobStage,
  setJobErrorCode,
  handleJobFailure,
  isDocumentDeleted,
  savePages,
  saveChunksWithEmbeddings,
  heartbeat,
  type IngestionJob,
} from './db.js'

const JOB_TIMEOUT_MS = parseInt(process.env.JOB_TIMEOUT_MS || '300000', 10) // 5 minutes

export interface ProcessResult {
  success: boolean
  pageCount: number
  chunkCount: number
  wordCount: number
  durationMs: number
  errorCode?: ErrorCode
}

/**
 * Process a single ingestion job
 */
export async function processJob(job: IngestionJob): Promise<ProcessResult> {
  const startTime = Date.now()
  console.log(`\n[Job ${job.id}] Starting processing`)
  console.log(`[Job ${job.id}] R2 Key: ${job.r2_key}`)
  console.log(`[Job ${job.id}] Attempt: ${job.attempts}/${job.max_attempts}`)

  // Create timeout promise
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Job timeout exceeded')), JOB_TIMEOUT_MS)
  })

  try {
    // Race against timeout
    const result = await Promise.race([
      processJobInternal(job, startTime),
      timeoutPromise,
    ])

    return result
  } catch (error) {
    console.error(`[Job ${job.id}] Error:`, error)

    // Classify the error
    const errorCode = classifyError(error)
    await setJobErrorCode(job.id, errorCode)
    await handleJobFailure(job, error as Error)

    return {
      success: false,
      pageCount: 0,
      chunkCount: 0,
      wordCount: 0,
      durationMs: Date.now() - startTime,
      errorCode,
    }
  }
}

async function processJobInternal(
  job: IngestionJob,
  startTime: number
): Promise<ProcessResult> {
  // Check if document was deleted
  const deleted = await isDocumentDeleted(job.document_version_id)
  if (deleted) {
    console.log(`[Job ${job.id}] Document deleted, aborting`)
    await updateJobStatus(job.id, 'cancelled', undefined, 'Document was deleted')
    return { success: false, pageCount: 0, chunkCount: 0, wordCount: 0, durationMs: Date.now() - startTime }
  }

  // PHASE 1: Download file from R2
  if (!job.r2_key) {
    throw new Error('Missing r2_key for job')
  }

  await updateJobStage(job.id, 'downloading')
  const downloadStart = Date.now()
  const fileBuffer = await downloadFromR2(job.r2_key)
  const downloadDuration = Date.now() - downloadStart
  await heartbeat(job.id)

  // Determine file type
  const mimeType = job.mime_type || 'application/pdf'
  const sourceType = job.source_type || 'pdf'

  // Check if file type is supported
  if (!isSupported(mimeType, sourceType)) {
    console.log(`[Job ${job.id}] Unsupported file type: ${mimeType} (source_type: ${sourceType})`)
    await setJobErrorCode(job.id, 'unsupported_format')
    await updateJobStatus(job.id, 'failed', {
      mimeType,
      sourceType,
    }, `Unsupported file type: ${mimeType}`)
    return {
      success: false,
      pageCount: 0,
      chunkCount: 0,
      wordCount: 0,
      durationMs: Date.now() - startTime,
      errorCode: 'unsupported_format',
    }
  }

  // PHASE 2: Parse document (routes to appropriate parser by type)
  await updateJobStage(job.id, 'parsing')
  const parseStart = Date.now()
  const parseResult = await parseDocument(fileBuffer, mimeType, sourceType)
  const parseDuration = Date.now() - parseStart
  await heartbeat(job.id)

  console.log(`[Job ${job.id}] Parsed ${parseResult.totalPages} pages, ${parseResult.totalWords} words using ${parseResult.parserUsed}`)

  // QUALITY GATE: Check extraction quality
  const normalizedPages = parseResult.pages.map(p => ({
    pageNumber: p.pageNumber,
    content: p.content,
    charCount: p.content.length,
  }))

  const qualityCheck = checkExtractionQuality(normalizedPages)

  if (!qualityCheck.passed) {
    console.log(`[Job ${job.id}] Quality gate failed: ${qualityCheck.issues.join(', ')}`)

    // Set error code and fail the job
    if (qualityCheck.errorCode) {
      await setJobErrorCode(job.id, qualityCheck.errorCode)
    }

    await updateJobStatus(job.id, 'failed', {
      pageCount: parseResult.totalPages,
      wordCount: parseResult.totalWords,
      parser: parseResult.parserUsed,
      mimeType,
      sourceType,
      qualityIssues: qualityCheck.issues,
      timings: { download: downloadDuration, parse: parseDuration },
    }, qualityCheck.issues.join('; '))

    return {
      success: false,
      pageCount: parseResult.totalPages,
      chunkCount: 0,
      wordCount: parseResult.totalWords,
      durationMs: Date.now() - startTime,
      errorCode: qualityCheck.errorCode,
    }
  }

  // Log quality warnings if any
  if (qualityCheck.issues.length > 0) {
    console.log(`[Job ${job.id}] Quality warnings: ${qualityCheck.issues.join(', ')}`)
  }

  // Check again if deleted
  if (await isDocumentDeleted(job.document_version_id)) {
    console.log(`[Job ${job.id}] Document deleted during processing, aborting`)
    await updateJobStatus(job.id, 'cancelled', undefined, 'Document was deleted')
    return { success: false, pageCount: 0, chunkCount: 0, wordCount: 0, durationMs: Date.now() - startTime }
  }

  // Save pages to database
  await savePages(
    job.document_version_id,
    parseResult.pages.map(p => ({
      pageNumber: p.pageNumber,
      content: p.content,
      metadata: { wordCount: p.content.split(/\s+/).filter(Boolean).length },
    }))
  )
  await heartbeat(job.id)

  // PHASE 3: Chunk
  await updateJobStage(job.id, 'chunking')
  const chunkStart = Date.now()
  const chunks = chunkPagesWithProvenance(
    parseResult.pages.map(p => ({ pageNumber: p.pageNumber, content: p.content })),
    { maxChunkSize: 1000, minChunkSize: 200, overlapSize: 100 }
  )
  const chunkDuration = Date.now() - chunkStart
  await heartbeat(job.id)

  console.log(`[Job ${job.id}] Created ${chunks.length} chunks`)

  if (chunks.length === 0) {
    await updateJobStatus(job.id, 'done', {
      pageCount: parseResult.totalPages,
      chunkCount: 0,
      wordCount: parseResult.totalWords,
      timings: { download: downloadDuration, parse: parseDuration, chunk: chunkDuration, embed: 0 },
      parser: parseResult.parserUsed,
      mimeType,
      sourceType,
      chunker: 'v1',
      model: 'text-embedding-3-small',
    })
    return {
      success: true,
      pageCount: parseResult.totalPages,
      chunkCount: 0,
      wordCount: parseResult.totalWords,
      durationMs: Date.now() - startTime,
    }
  }

  // PHASE 4: Generate embeddings
  await updateJobStage(job.id, 'embedding')
  const embedStart = Date.now()
  const embeddings = await generateEmbeddingsBatched(
    chunks.map(c => c.content),
    50 // Batch size
  )
  const embedDuration = Date.now() - embedStart
  await heartbeat(job.id)

  console.log(`[Job ${job.id}] Generated ${embeddings.length} embeddings`)

  // Final check if deleted
  if (await isDocumentDeleted(job.document_version_id)) {
    console.log(`[Job ${job.id}] Document deleted during embedding, aborting`)
    await updateJobStatus(job.id, 'cancelled', undefined, 'Document was deleted')
    return { success: false, pageCount: 0, chunkCount: 0, wordCount: 0, durationMs: Date.now() - startTime }
  }

  // Save chunks with embeddings
  await saveChunksWithEmbeddings(
    job.document_version_id,
    job.business_id,
    chunks.map((chunk, index) => ({
      chunkIndex: chunk.chunkIndex,
      content: chunk.content,
      pageStart: chunk.pageStart,
      pageEnd: chunk.pageEnd,
      metadata: { sentences: chunk.sentences.length },
      embedding: embeddings[index],
    }))
  )

  // Mark job as done
  const totalDuration = Date.now() - startTime
  await updateJobStatus(job.id, 'done', {
    pageCount: parseResult.totalPages,
    chunkCount: chunks.length,
    wordCount: parseResult.totalWords,
    timings: {
      download: downloadDuration,
      parse: parseDuration,
      chunk: chunkDuration,
      embed: embedDuration,
      total: totalDuration,
    },
    parser: parseResult.parserUsed,
    mimeType,
    sourceType,
    chunker: 'v1',
    model: 'text-embedding-3-small',
  })

  console.log(`[Job ${job.id}] Completed in ${totalDuration}ms`)

  return {
    success: true,
    pageCount: parseResult.totalPages,
    chunkCount: chunks.length,
    wordCount: parseResult.totalWords,
    durationMs: totalDuration,
  }
}
