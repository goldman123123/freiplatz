/**
 * TXT Parser
 *
 * Handles plain text files with UTF-8 encoding.
 * Splits into logical pages for chunking consistency.
 */

import type { ParsedDocument } from '../parser-router.js'

// Lines per logical page (for chunking consistency)
const LINES_PER_PAGE = 100

/**
 * Extract text from plain text buffer
 *
 * @param buffer - TXT file as Buffer (UTF-8)
 * @returns Normalized parsed document
 */
export async function extractWithTxt(buffer: Buffer): Promise<ParsedDocument> {
  console.log(`[TXT] Parsing TXT (${buffer.length} bytes)`)

  // Decode as UTF-8 and normalize line endings
  const content = buffer
    .toString('utf-8')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()

  if (!content) {
    console.log('[TXT] Empty file')
    return {
      pages: [],
      totalPages: 0,
      totalChars: 0,
      totalWords: 0,
      metadata: { encoding: 'utf-8' },
      parserUsed: 'txt',
    }
  }

  // Split into lines
  const lines = content.split('\n')

  // Create logical pages
  const pages: Array<{ pageNumber: number; content: string }> = []

  for (let i = 0; i < lines.length; i += LINES_PER_PAGE) {
    const pageLines = lines.slice(i, i + LINES_PER_PAGE)
    const pageContent = pageLines.join('\n').trim()

    if (pageContent) {
      pages.push({
        pageNumber: Math.floor(i / LINES_PER_PAGE) + 1,
        content: pageContent,
      })
    }
  }

  const totalChars = content.length
  const totalWords = content.split(/\s+/).filter(Boolean).length

  console.log(`[TXT] Extracted ${pages.length} logical pages, ${totalWords} words, ${lines.length} lines`)

  return {
    pages,
    totalPages: pages.length,
    totalChars,
    totalWords,
    metadata: {
      lineCount: lines.length,
      encoding: 'utf-8',
    },
    parserUsed: 'txt',
  }
}
