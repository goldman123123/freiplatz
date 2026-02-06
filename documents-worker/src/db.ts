/**
 * Database client and job management queries
 */

import { neon, neonConfig } from '@neondatabase/serverless'

// Configure Neon for worker environment
neonConfig.fetchConnectionCache = true

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required')
}

// Create SQL client
const sql = neon(DATABASE_URL)

// Job status enum - operational state
export type JobStatus =
  | 'queued'
  | 'processing'
  | 'done'
  | 'retry_ready'
  | 'failed'
  | 'cancelled'

// Legacy status values for job claiming (also used as stages)
export type JobStage =
  | 'pending_upload'
  | 'uploaded'
  | 'downloading'
  | 'parsing'
  | 'chunking'
  | 'embedding'
  | 'cleanup'

export interface IngestionJob {
  id: string
  document_version_id: string
  business_id: string
  status: JobStatus
  stage?: JobStage
  error_code?: string
  source_type?: string
  attempts: number
  max_attempts: number
  last_error: string | null
  next_retry_at: string | null
  started_at: string | null
  completed_at: string | null
  metrics: Record<string, unknown>
  created_at: string
  updated_at: string
  r2_key?: string // Joined from document_versions
  mime_type?: string // Joined from document_versions
}

/**
 * Claim jobs for processing using FOR UPDATE SKIP LOCKED
 * This prevents race conditions with multiple workers
 *
 * Now claims jobs with status 'queued' and stage 'uploaded' (ready for processing)
 * or status 'retry_ready' (for retries)
 */
export async function claimJobs(batchSize: number): Promise<IngestionJob[]> {
  const result = await sql`
    WITH claimed AS (
      SELECT ij.id
      FROM ingestion_jobs ij
      WHERE (
        (ij.status = 'queued' AND ij.stage = 'uploaded')
        OR ij.status = 'retry_ready'
      )
        AND (ij.next_retry_at IS NULL OR ij.next_retry_at <= NOW())
      ORDER BY ij.created_at
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE ingestion_jobs
    SET
      status = 'processing',
      stage = 'downloading',
      attempts = attempts + 1,
      started_at = NOW(),
      updated_at = NOW()
    WHERE id IN (SELECT id FROM claimed)
    RETURNING
      ingestion_jobs.*,
      (SELECT r2_key FROM document_versions WHERE id = ingestion_jobs.document_version_id) as r2_key,
      (SELECT mime_type FROM document_versions WHERE id = ingestion_jobs.document_version_id) as mime_type
  `

  return result as IngestionJob[]
}

/**
 * Update job status (operational state)
 */
export async function updateJobStatus(
  jobId: string,
  status: JobStatus,
  metrics?: Record<string, unknown>,
  error?: string
): Promise<void> {
  if (metrics) {
    // Merge metrics
    await sql`
      UPDATE ingestion_jobs
      SET
        status = ${status},
        updated_at = NOW(),
        ${status === 'done' ? sql`completed_at = NOW(),` : sql``}
        ${error ? sql`last_error = ${error},` : sql``}
        metrics = metrics || ${JSON.stringify(metrics)}::jsonb
      WHERE id = ${jobId}
    `
    return
  }

  if (error) {
    await sql`
      UPDATE ingestion_jobs
      SET status = ${status}, updated_at = NOW(), last_error = ${error}
      WHERE id = ${jobId}
    `
  } else if (status === 'done') {
    await sql`
      UPDATE ingestion_jobs
      SET status = ${status}, updated_at = NOW(), completed_at = NOW()
      WHERE id = ${jobId}
    `
  } else {
    await sql`
      UPDATE ingestion_jobs
      SET status = ${status}, updated_at = NOW()
      WHERE id = ${jobId}
    `
  }
}

/**
 * Update job stage (progress indicator within processing status)
 * Does NOT change the status, only the stage
 */
export async function updateJobStage(
  jobId: string,
  stage: JobStage
): Promise<void> {
  await sql`
    UPDATE ingestion_jobs
    SET stage = ${stage}, updated_at = NOW()
    WHERE id = ${jobId}
  `
}

/**
 * Set error code on a job (why it failed)
 */
export async function setJobErrorCode(
  jobId: string,
  errorCode: string
): Promise<void> {
  await sql`
    UPDATE ingestion_jobs
    SET error_code = ${errorCode}, updated_at = NOW()
    WHERE id = ${jobId}
  `
}

/**
 * Heartbeat - update timestamp to prevent stuck job detection
 */
export async function heartbeat(jobId: string): Promise<void> {
  await sql`
    UPDATE ingestion_jobs
    SET updated_at = NOW()
    WHERE id = ${jobId}
  `
}

/**
 * Mark job as failed and schedule retry (or permanent failure)
 */
export async function handleJobFailure(
  job: IngestionJob,
  error: Error
): Promise<void> {
  const errorMessage = error.message.slice(0, 1000) // Limit error length

  if (job.attempts >= job.max_attempts) {
    // Permanent failure
    await sql`
      UPDATE ingestion_jobs
      SET
        status = 'failed',
        last_error = ${errorMessage},
        updated_at = NOW()
      WHERE id = ${job.id}
    `
    console.error(`[Job ${job.id}] Permanently failed after ${job.attempts} attempts: ${errorMessage}`)
  } else {
    // Schedule retry with exponential backoff
    const backoffMinutes = Math.pow(5, job.attempts) // 5, 25, 125 minutes
    const nextRetry = new Date(Date.now() + backoffMinutes * 60 * 1000)

    await sql`
      UPDATE ingestion_jobs
      SET
        status = 'retry_ready',
        last_error = ${errorMessage},
        next_retry_at = ${nextRetry.toISOString()},
        updated_at = NOW()
      WHERE id = ${job.id}
    `
    console.log(`[Job ${job.id}] Scheduled retry in ${backoffMinutes} minutes (attempt ${job.attempts}/${job.max_attempts})`)
  }
}

/**
 * Check if document is marked for deletion
 */
export async function isDocumentDeleted(documentVersionId: string): Promise<boolean> {
  const result = await sql`
    SELECT d.status
    FROM documents d
    JOIN document_versions dv ON d.id = dv.document_id
    WHERE dv.id = ${documentVersionId}
    LIMIT 1
  `

  if (result.length === 0) return true
  return result[0].status === 'deleted_pending' || result[0].status === 'deleted'
}

/**
 * Save extracted pages to database
 */
export async function savePages(
  documentVersionId: string,
  pages: Array<{ pageNumber: number; content: string; metadata?: Record<string, unknown> }>
): Promise<void> {
  for (const page of pages) {
    await sql`
      INSERT INTO document_pages (document_version_id, page_number, content, metadata)
      VALUES (${documentVersionId}, ${page.pageNumber}, ${page.content}, ${JSON.stringify(page.metadata || {})}::jsonb)
      ON CONFLICT (document_version_id, page_number) DO UPDATE
      SET content = ${page.content}, metadata = ${JSON.stringify(page.metadata || {})}::jsonb
    `
  }
}

/**
 * Save chunks with embeddings to database
 */
export async function saveChunksWithEmbeddings(
  documentVersionId: string,
  businessId: string,
  chunks: Array<{
    chunkIndex: number
    content: string
    pageStart: number
    pageEnd: number
    metadata?: Record<string, unknown>
    embedding: number[]
  }>
): Promise<void> {
  for (const chunk of chunks) {
    // Insert chunk
    const chunkResult = await sql`
      INSERT INTO document_chunks (document_version_id, business_id, chunk_index, content, page_start, page_end, metadata)
      VALUES (${documentVersionId}, ${businessId}, ${chunk.chunkIndex}, ${chunk.content}, ${chunk.pageStart}, ${chunk.pageEnd}, ${JSON.stringify(chunk.metadata || {})}::jsonb)
      ON CONFLICT (document_version_id, chunk_index) DO UPDATE
      SET content = ${chunk.content}, page_start = ${chunk.pageStart}, page_end = ${chunk.pageEnd}, metadata = ${JSON.stringify(chunk.metadata || {})}::jsonb
      RETURNING id
    `

    const chunkId = chunkResult[0].id

    // Insert embedding
    await sql`
      INSERT INTO chunk_embeddings (chunk_id, business_id, embedding)
      VALUES (${chunkId}, ${businessId}, ${JSON.stringify(chunk.embedding)}::vector)
      ON CONFLICT (chunk_id) DO UPDATE
      SET embedding = ${JSON.stringify(chunk.embedding)}::vector
    `
  }
}

export { sql }
