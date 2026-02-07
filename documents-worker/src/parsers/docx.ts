/**
 * DOCX Parser
 *
 * Uses mammoth to extract text from Word documents.
 * Handles both .docx and legacy .doc formats.
 */

import mammoth from 'mammoth'
import type { ParsedDocument } from '../parser-router.js'

// Approximate lines per logical page (for chunking consistency)
const LINES_PER_PAGE = 50

/**
 * Extract text from DOCX buffer
 *
 * DOCX files don't have native page boundaries, so we create
 * logical pages based on paragraph count for chunking consistency.
 *
 * @param buffer - DOCX file as Buffer
 * @returns Normalized parsed document
 */
export async function extractWithDocx(buffer: Buffer): Promise<ParsedDocument> {
  console.log(`[DOCX] Parsing DOCX (${buffer.length} bytes)`)

  const result = await mammoth.extractRawText({ buffer })

  // Log any warnings (e.g., unsupported features)
  if (result.messages.length > 0) {
    const warnings = result.messages.filter(m => m.type === 'warning')
    if (warnings.length > 0) {
      console.warn(`[DOCX] ${warnings.length} warnings:`, warnings.slice(0, 3).map(w => w.message))
    }
  }

  // Normalize content
  const content = result.value
    .replace(/\r\n/g, '\n') // Normalize line endings
    .replace(/\n{3,}/g, '\n\n') // Collapse multiple blank lines
    .trim()

  if (!content) {
    console.log('[DOCX] No text content extracted')
    return {
      pages: [],
      totalPages: 0,
      totalChars: 0,
      totalWords: 0,
      metadata: {
        warnings: result.messages.map(m => m.message),
      },
      parserUsed: 'docx',
    }
  }

  // Split into logical pages by paragraph count
  const paragraphs = content.split(/\n\n+/)
  const pages: Array<{ pageNumber: number; content: string }> = []

  // Group paragraphs into pages
  for (let i = 0; i < paragraphs.length; i += LINES_PER_PAGE) {
    const pageParagraphs = paragraphs.slice(i, i + LINES_PER_PAGE)
    const pageContent = pageParagraphs.join('\n\n').trim()

    if (pageContent) {
      pages.push({
        pageNumber: Math.floor(i / LINES_PER_PAGE) + 1,
        content: pageContent,
      })
    }
  }

  // If no pages created (short document), use single page
  if (pages.length === 0 && content) {
    pages.push({
      pageNumber: 1,
      content,
    })
  }

  const totalChars = content.length
  const totalWords = content.split(/\s+/).filter(Boolean).length

  console.log(`[DOCX] Extracted ${pages.length} logical pages, ${totalWords} words`)

  return {
    pages,
    totalPages: pages.length,
    totalChars,
    totalWords,
    metadata: {
      paragraphCount: paragraphs.length,
      warnings: result.messages
        .filter(m => m.type === 'warning')
        .map(m => m.message),
    },
    parserUsed: 'docx',
  }
}
