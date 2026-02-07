/**
 * PDF Parser
 *
 * Uses pdfjs-dist first (better font encoding support),
 * falls back to pdf-parse if pdfjs-dist fails or extracts nothing.
 */

import pdfParse from 'pdf-parse'
import { extractWithPdfjs } from './pdfjs-extractor.js'
import type { ParsedDocument } from '../parser-router.js'

/**
 * Extract text from PDF buffer with page-level granularity
 *
 * Tries pdfjs-dist first (better font encoding), falls back to pdf-parse
 *
 * @param buffer - PDF file as Buffer
 * @returns Normalized parsed document
 */
export async function extractWithPdf(buffer: Buffer): Promise<ParsedDocument> {
  console.log(`[PDF] Parsing PDF (${buffer.length} bytes)`)

  // Try pdfjs-dist first (better font encoding support)
  try {
    const pdfjsResult = await extractWithPdfjs(buffer)

    // Check if extraction was meaningful
    if (pdfjsResult.totalChars > 0) {
      console.log(`[PDF] pdfjs-dist extracted ${pdfjsResult.totalChars} chars from ${pdfjsResult.totalPages} pages`)

      // Calculate word count
      const totalWords = pdfjsResult.pages.reduce((sum, p) => {
        return sum + p.content.split(/\s+/).filter(Boolean).length
      }, 0)

      return {
        pages: pdfjsResult.pages.map(p => ({
          pageNumber: p.pageNumber,
          content: p.content,
        })),
        totalPages: pdfjsResult.totalPages,
        totalChars: pdfjsResult.totalChars,
        totalWords,
        metadata: {
          ...pdfjsResult.metadata,
          parserVariant: 'pdfjs-dist',
        },
        parserUsed: 'pdf',
      }
    }

    console.log('[PDF] pdfjs-dist extracted 0 chars, trying pdf-parse fallback')
  } catch (pdfjsError) {
    console.warn('[PDF] pdfjs-dist failed, trying pdf-parse fallback:', pdfjsError)
  }

  // Fallback to pdf-parse
  return await extractWithPdfParse(buffer)
}

/**
 * Extract text using pdf-parse (fallback)
 */
async function extractWithPdfParse(buffer: Buffer): Promise<ParsedDocument> {
  console.log('[PDF] Using pdf-parse')

  // Parse the PDF with custom page render function
  const data = await pdfParse(buffer, {
    pagerender: pageRenderFunction,
  })

  // Split content by page markers
  const pageContents = data.text.split(/\n--- PAGE \d+ ---\n/).filter(Boolean)

  const pages = pageContents.map((content, index) => ({
    pageNumber: index + 1,
    content: content.trim(),
  }))

  // If page splitting didn't work, treat as single page
  if (pages.length === 0 && data.text.trim()) {
    pages.push({
      pageNumber: 1,
      content: data.text.trim(),
    })
  }

  const totalChars = pages.reduce((sum, p) => sum + p.content.length, 0)
  const totalWords = pages.reduce((sum, p) => {
    return sum + p.content.split(/\s+/).filter(Boolean).length
  }, 0)

  console.log(`[PDF] pdf-parse extracted ${pages.length} pages, ${totalWords} words`)

  return {
    pages,
    totalPages: data.numpages || pages.length,
    totalChars,
    totalWords,
    metadata: {
      info: data.info || {},
      version: data.version || 'unknown',
      parserVariant: 'pdf-parse',
    },
    parserUsed: 'pdf',
  }
}

/**
 * Custom page render function to mark page boundaries
 */
function pageRenderFunction(
  pageData: {
    pageIndex: number
    getTextContent: () => Promise<{ items: Array<{ str: string }> }>
  }
) {
  return pageData.getTextContent().then((textContent) => {
    const text = textContent.items.map((item) => item.str).join(' ')
    // Add page marker that we can split on later
    return `\n--- PAGE ${pageData.pageIndex + 1} ---\n${text}`
  })
}
