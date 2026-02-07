/**
 * Semantic Chunker with Page Provenance
 *
 * Adapted from the Next.js app's semantic-chunker.ts
 * Adds page tracking for citation support
 */

export interface ChunkWithProvenance {
  content: string
  chunkIndex: number
  pageStart: number
  pageEnd: number
  sentences: string[]
  metadata?: Record<string, unknown>
}

export interface ChunkOptions {
  maxChunkSize?: number // Max characters per chunk (default: 1000)
  minChunkSize?: number // Min characters per chunk (default: 200)
  overlapSize?: number // Character overlap between chunks (default: 100)
}

interface PageContent {
  pageNumber: number
  content: string
}

/**
 * Chunk pages into semantic chunks with page provenance
 */
export function chunkPagesWithProvenance(
  pages: PageContent[],
  options: ChunkOptions = {}
): ChunkWithProvenance[] {
  const {
    maxChunkSize = 1000,
    minChunkSize = 200,
    overlapSize = 100,
  } = options

  const chunks: ChunkWithProvenance[] = []
  let currentChunkSentences: string[] = []
  let currentChunkSize = 0
  let currentPageStart = 1
  let currentPageEnd = 1
  let chunkIndex = 0

  for (const page of pages) {
    if (!page.content.trim()) continue

    // Clean and normalize text
    const cleanedText = page.content
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()

    // Split into sentences
    const sentences = splitIntoSentences(cleanedText)

    for (const sentence of sentences) {
      const sentenceSize = sentence.length

      // Check if adding this sentence would exceed max chunk size
      if (
        currentChunkSize + sentenceSize > maxChunkSize &&
        currentChunkSentences.length > 0
      ) {
        // Create chunk from accumulated sentences
        const chunk = createChunk(
          currentChunkSentences,
          chunkIndex,
          currentPageStart,
          currentPageEnd
        )

        // Only add if meets minimum size
        if (chunk.content.length >= minChunkSize) {
          chunks.push(chunk)
          chunkIndex++
        }

        // Keep overlap sentences for context continuity
        const overlapSentences = getOverlapSentences(currentChunkSentences, overlapSize)
        currentChunkSentences = overlapSentences
        currentChunkSize = overlapSentences.join(' ').length
        currentPageStart = page.pageNumber // New chunk starts on current page
      }

      // Add sentence to current chunk
      currentChunkSentences.push(sentence.trim())
      currentChunkSize += sentenceSize
      currentPageEnd = page.pageNumber
    }
  }

  // Add final chunk
  if (currentChunkSentences.length > 0) {
    const chunk = createChunk(
      currentChunkSentences,
      chunkIndex,
      currentPageStart,
      currentPageEnd
    )

    if (chunk.content.length >= minChunkSize) {
      chunks.push(chunk)
    }
  }

  console.log(`[Chunker] Created ${chunks.length} chunks from ${pages.length} pages`)

  return chunks
}

/**
 * Split text into sentences
 */
function splitIntoSentences(text: string): string[] {
  // Split on sentence boundaries: . ! ? followed by space/newline
  // But preserve decimal numbers and common abbreviations
  const sentenceRegex = /(?<=[.!?])\s+(?=[A-ZÄÖÜ])|(?<=[.!?])\n+/

  const sentences = text
    .split(sentenceRegex)
    .map(s => s.trim())
    .filter(s => s.length > 0)

  // Handle case where no sentence boundaries found
  if (sentences.length === 0 && text.trim()) {
    return [text.trim()]
  }

  return sentences
}

/**
 * Create a chunk from sentences
 */
function createChunk(
  sentences: string[],
  chunkIndex: number,
  pageStart: number,
  pageEnd: number
): ChunkWithProvenance {
  const content = sentences.join(' ')

  return {
    content,
    chunkIndex,
    pageStart,
    pageEnd,
    sentences: [...sentences],
  }
}

/**
 * Get sentences for overlap
 */
function getOverlapSentences(sentences: string[], overlapSize: number): string[] {
  if (sentences.length === 0) return []

  let totalSize = 0
  const overlapSentences: string[] = []

  for (let i = sentences.length - 1; i >= 0; i--) {
    const sentence = sentences[i]
    totalSize += sentence.length

    if (totalSize > overlapSize) break

    overlapSentences.unshift(sentence)
  }

  return overlapSentences
}
