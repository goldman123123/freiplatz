/**
 * URL Processor - Handles URL scraping jobs
 *
 * Scrapes URLs, creates document records, stores in R2,
 * and processes through the chunking/embedding pipeline.
 *
 * Key features:
 * - Treats scraped URLs as documents with mimeType='text/html'
 * - SHA-256 hash deduplication
 * - Dual-write to chatbot_knowledge for extracted snippets
 */

import * as crypto from 'crypto'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { r2Client, R2_BUCKET_NAME } from './r2.js'
import { chunkPagesWithProvenance } from './chunker.js'
import { generateEmbeddingsBatched, generateEmbedding } from './embed.js'
import {
  sql,
  updateJobStatus,
  updateJobStage,
  setJobErrorCode,
  heartbeat,
  saveChunksWithEmbeddings,
} from './db.js'

// Simple HTML to text extraction
import * as cheerio from 'cheerio'

const SCRAPE_TIMEOUT_MS = 15000
const MAX_CONTENT_SIZE = 5 * 1024 * 1024 // 5MB

export interface UrlJob {
  id: string
  business_id: string
  source_url: string
  discovered_urls: string[]
  scrape_config: {
    audience: string
    scopeType: string
    dataClass: string
  }
  extract_services: boolean
  attempts: number
  max_attempts: number
}

export interface UrlProcessResult {
  success: boolean
  documentsCreated: number
  chunksCreated: number
  knowledgeEntriesCreated: number
  durationMs: number
  errorCode?: string
}

interface ScrapedPage {
  url: string
  title: string
  markdown: string
  contentHash: string
  wordCount: number
}

/**
 * Process a URL scraping job
 */
export async function processUrlJob(job: UrlJob): Promise<UrlProcessResult> {
  const startTime = Date.now()
  console.log(`\n[URL Job ${job.id}] Starting URL processing`)
  console.log(`[URL Job ${job.id}] URLs to scrape: ${job.discovered_urls.length}`)

  let documentsCreated = 0
  let totalChunks = 0
  let knowledgeEntriesCreated = 0

  try {
    await updateJobStage(job.id, 'scraping' as any)

    // Process each URL
    for (const url of job.discovered_urls) {
      try {
        console.log(`[URL Job ${job.id}] Scraping: ${url}`)

        // Scrape the page
        const scraped = await scrapePage(url)
        await heartbeat(job.id)

        // Check for duplicate by content hash
        const existing = await checkExistingHash(job.business_id, scraped.contentHash)
        if (existing) {
          console.log(`[URL Job ${job.id}] Duplicate content detected, skipping: ${url}`)
          continue
        }

        // Create document record
        const documentId = await createDocumentRecord(job, scraped)
        await heartbeat(job.id)

        // Store markdown in R2
        const r2Key = `${job.business_id}/html/${documentId}.md`
        await uploadToR2(r2Key, scraped.markdown)
        await heartbeat(job.id)

        // Create version record
        const versionId = await createVersionRecord(documentId, r2Key, scraped)
        await heartbeat(job.id)
        documentsCreated++

        // Update job stage to chunking
        await updateJobStage(job.id, 'chunking' as any)

        // Chunk the content
        const pages = [{ pageNumber: 1, content: scraped.markdown }]
        const chunks = chunkPagesWithProvenance(pages, {
          maxChunkSize: 1000,
          minChunkSize: 200,
          overlapSize: 100,
        })
        await heartbeat(job.id)

        if (chunks.length === 0) {
          console.log(`[URL Job ${job.id}] No chunks created for: ${url}`)
          continue
        }

        // Update job stage to embedding
        await updateJobStage(job.id, 'embedding' as any)

        // Generate embeddings
        const embeddings = await generateEmbeddingsBatched(
          chunks.map(c => c.content),
          50
        )
        await heartbeat(job.id)

        // Save chunks with embeddings
        await saveChunksWithEmbeddings(
          versionId,
          job.business_id,
          chunks.map((chunk, index) => ({
            chunkIndex: chunk.chunkIndex,
            content: chunk.content,
            pageStart: chunk.pageStart,
            pageEnd: chunk.pageEnd,
            metadata: {
              sentences: chunk.sentences.length,
              sourceUrl: url,
            },
            embedding: embeddings[index],
          }))
        )
        totalChunks += chunks.length
        await heartbeat(job.id)

        // Extract knowledge entries (dual-write)
        if (job.scrape_config.dataClass === 'knowledge') {
          await updateJobStage(job.id, 'extracting' as any)
          const knowledgeCount = await extractAndSaveKnowledge(
            job,
            documentId,
            scraped
          )
          knowledgeEntriesCreated += knowledgeCount
          await heartbeat(job.id)
        }

        console.log(`[URL Job ${job.id}] Processed ${url}: ${chunks.length} chunks`)
      } catch (urlError) {
        console.error(`[URL Job ${job.id}] Error processing ${url}:`, urlError)
        // Continue with other URLs
      }
    }

    // Mark job as done
    const durationMs = Date.now() - startTime
    await updateJobStatus(job.id, 'done', {
      documentsCreated,
      chunksCreated: totalChunks,
      knowledgeEntriesCreated,
      urlsProcessed: job.discovered_urls.length,
      durationMs,
    })

    console.log(`[URL Job ${job.id}] Completed in ${durationMs}ms: ${documentsCreated} docs, ${totalChunks} chunks, ${knowledgeEntriesCreated} knowledge entries`)

    return {
      success: true,
      documentsCreated,
      chunksCreated: totalChunks,
      knowledgeEntriesCreated,
      durationMs,
    }
  } catch (error) {
    console.error(`[URL Job ${job.id}] Fatal error:`, error)

    const errorCode = 'scrape_failed'
    await setJobErrorCode(job.id, errorCode)
    await updateJobStatus(job.id, 'failed', undefined, (error as Error).message)

    return {
      success: false,
      documentsCreated,
      chunksCreated: totalChunks,
      knowledgeEntriesCreated,
      durationMs: Date.now() - startTime,
      errorCode,
    }
  }
}

/**
 * Scrape a single page and convert to markdown
 */
async function scrapePage(url: string): Promise<ScrapedPage> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; HebelkiBot/1.0; Website scraper)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Charset': 'utf-8',
      },
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const contentLength = response.headers.get('content-length')
    if (contentLength && parseInt(contentLength) > MAX_CONTENT_SIZE) {
      throw new Error('Content too large')
    }

    // Get the raw bytes and decode with proper encoding
    const buffer = await response.arrayBuffer()

    // Detect encoding from Content-Type header or default to UTF-8
    const contentType = response.headers.get('content-type') || ''
    const charsetMatch = contentType.match(/charset=([^\s;]+)/i)
    let encoding = charsetMatch ? charsetMatch[1].toLowerCase() : 'utf-8'

    // Normalize common encoding names
    if (encoding === 'iso-8859-1' || encoding === 'latin1' || encoding === 'latin-1') {
      encoding = 'iso-8859-1'
    }

    // Decode the HTML with the correct encoding
    let html: string
    try {
      const decoder = new TextDecoder(encoding)
      html = decoder.decode(buffer)
    } catch {
      // Fallback to UTF-8 if encoding is not supported
      const decoder = new TextDecoder('utf-8')
      html = decoder.decode(buffer)
    }

    // Check for meta charset in HTML and re-decode if needed
    const metaCharsetMatch = html.match(/<meta[^>]+charset=["']?([^"'\s>]+)/i)
    if (metaCharsetMatch && metaCharsetMatch[1].toLowerCase() !== encoding) {
      const metaEncoding = metaCharsetMatch[1].toLowerCase()
      try {
        const decoder = new TextDecoder(metaEncoding)
        html = decoder.decode(buffer)
      } catch {
        // Keep the original decode if meta charset is not supported
      }
    }
    const $ = cheerio.load(html)

    // Extract title
    const title = $('title').text().trim() ||
      $('h1').first().text().trim() ||
      new URL(url).pathname

    // Remove non-content elements
    $('script, style, noscript, iframe, svg').remove()
    $('nav, header, footer, aside').remove()
    $('[role="navigation"], [role="banner"], [role="contentinfo"]').remove()
    $('form, input, button').remove()
    $('.cookie-banner, .cookie-notice, #cookie-consent').remove()

    // Get main content
    let content = ''
    const main = $('main, article, [role="main"]')
    if (main.length > 0) {
      content = main.text()
    } else {
      content = $('body').text() || $.text()
    }

    // Convert to clean markdown-like text
    const markdown = content
      .replace(/\t/g, ' ')
      .replace(/[ ]+/g, ' ')
      .replace(/\n[ ]+/g, '\n')
      .replace(/[ ]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()

    // Generate content hash
    const contentHash = crypto
      .createHash('sha256')
      .update(markdown)
      .digest('hex')

    // Count words
    const wordCount = markdown.split(/\s+/).filter(Boolean).length

    return {
      url,
      title,
      markdown,
      contentHash,
      wordCount,
    }
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Check if content hash already exists
 */
async function checkExistingHash(
  businessId: string,
  contentHash: string
): Promise<boolean> {
  const result = await sql`
    SELECT dv.id
    FROM document_versions dv
    JOIN documents d ON d.id = dv.document_id
    WHERE d.business_id = ${businessId}
      AND dv.sha256_hash = ${contentHash}
    LIMIT 1
  `
  return result.length > 0
}

/**
 * Create document record
 */
async function createDocumentRecord(
  job: UrlJob,
  scraped: ScrapedPage
): Promise<string> {
  const result = await sql`
    INSERT INTO documents (
      business_id,
      title,
      original_filename,
      status,
      audience,
      scope_type,
      scope_id,
      data_class,
      contains_pii
    ) VALUES (
      ${job.business_id},
      ${scraped.title},
      ${scraped.url},
      'active',
      ${job.scrape_config.audience},
      ${job.scrape_config.scopeType},
      NULL,
      ${job.scrape_config.dataClass},
      false
    )
    RETURNING id
  `
  return result[0].id
}

/**
 * Create version record with hash
 */
async function createVersionRecord(
  documentId: string,
  r2Key: string,
  scraped: ScrapedPage
): Promise<string> {
  const result = await sql`
    INSERT INTO document_versions (
      document_id,
      version,
      r2_key,
      file_size,
      mime_type,
      sha256_hash
    ) VALUES (
      ${documentId},
      1,
      ${r2Key},
      ${Buffer.byteLength(scraped.markdown, 'utf-8')},
      'text/html',
      ${scraped.contentHash}
    )
    RETURNING id
  `
  return result[0].id
}

/**
 * Upload content to R2
 */
async function uploadToR2(r2Key: string, content: string): Promise<void> {
  console.log(`[R2] Uploading: ${r2Key}`)

  const command = new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: r2Key,
    Body: content,
    ContentType: 'text/markdown',
  })

  await r2Client.send(command)
  console.log(`[R2] Uploaded ${Buffer.byteLength(content, 'utf-8')} bytes`)
}

/**
 * Extract knowledge entries and save to chatbot_knowledge
 * This implements the "dual-write" pattern for optimal RAG
 */
async function extractAndSaveKnowledge(
  job: UrlJob,
  documentId: string,
  scraped: ScrapedPage
): Promise<number> {
  // For now, create a single knowledge entry from the page content
  // In the future, this could use AI to extract multiple categorized snippets

  // Truncate content for knowledge entry (max 2000 chars for quick retrieval)
  const knowledgeContent = scraped.markdown.length > 2000
    ? scraped.markdown.slice(0, 2000) + '...'
    : scraped.markdown

  // Generate embedding for the knowledge entry
  const embedding = await generateEmbedding(knowledgeContent)

  // Detect category from URL/title
  const category = detectCategory(scraped.url, scraped.title)

  await sql`
    INSERT INTO chatbot_knowledge (
      business_id,
      source,
      content,
      title,
      category,
      metadata,
      embedding,
      is_active,
      audience,
      scope_type,
      scope_id,
      source_document_id
    ) VALUES (
      ${job.business_id},
      'website',
      ${knowledgeContent},
      ${scraped.title},
      ${category},
      ${JSON.stringify({
        sourceUrl: scraped.url,
        scrapedAt: new Date().toISOString(),
        contentHash: scraped.contentHash,
        wordCount: scraped.wordCount,
      })}::jsonb,
      ${JSON.stringify(embedding)}::vector,
      true,
      ${job.scrape_config.audience},
      ${job.scrape_config.scopeType},
      NULL,
      ${documentId}
    )
  `

  console.log(`[URL Job ${job.id}] Created knowledge entry: ${scraped.title} (${category})`)
  return 1
}

/**
 * Detect knowledge category from URL and title
 */
function detectCategory(url: string, title: string): string {
  const urlLower = url.toLowerCase()
  const titleLower = title.toLowerCase()
  const combined = urlLower + ' ' + titleLower

  // Category detection rules
  if (combined.includes('faq') || combined.includes('häufig')) return 'faq'
  if (combined.includes('service') || combined.includes('leistung') || combined.includes('dienst')) return 'services'
  if (combined.includes('preis') || combined.includes('kosten') || combined.includes('price')) return 'pricing'
  if (combined.includes('kontakt') || combined.includes('contact')) return 'contact'
  if (combined.includes('öffnungszeit') || combined.includes('opening') || combined.includes('hours')) return 'hours'
  if (combined.includes('impressum') || combined.includes('datenschutz') || combined.includes('agb') || combined.includes('privacy')) return 'legal'
  if (combined.includes('about') || combined.includes('über') || combined.includes('team')) return 'about'
  if (combined.includes('blog') || combined.includes('news') || combined.includes('artikel')) return 'blog'

  return 'general'
}
