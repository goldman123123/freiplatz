/**
 * PDF Parser with Multiple Extractors
 *
 * Uses pdfjs-dist first (better font encoding support),
 * falls back to pdf-parse if pdfjs-dist fails or extracts nothing.
 */

import pdfParse from 'pdf-parse'
import { extractWithPdfjs } from './parsers/pdfjs-extractor.js'

export interface ExtractedPage {
  pageNumber: number
  content: string
  wordCount: number
}

export interface ParseResult {
  pages: ExtractedPage[]
  totalPages: number
  totalWords: number
  metadata: {
    info: Record<string, unknown>
    version: string
    parserUsed: 'pdfjs-dist' | 'pdf-parse'
  }
}

/**
 * Extract text from PDF buffer with page-level granularity
 *
 * Tries pdfjs-dist first (better font encoding), falls back to pdf-parse
 *
 * @param pdfBuffer - PDF file as Buffer
 * @returns Extracted pages with content
 */
export async function extractTextFromPdf(pdfBuffer: Buffer): Promise<ParseResult> {
  console.log(`[PDF Parser] Parsing PDF (${pdfBuffer.length} bytes)`)

  // Try pdfjs-dist first (better font encoding support)
  try {
    const pdfjsResult = await extractWithPdfjs(pdfBuffer)

    // Check if extraction was meaningful
    if (pdfjsResult.totalChars > 0) {
      console.log(`[PDF Parser] pdfjs-dist extracted ${pdfjsResult.totalChars} chars from ${pdfjsResult.totalPages} pages`)

      // Convert to our format
      const pages: ExtractedPage[] = pdfjsResult.pages.map(p => ({
        pageNumber: p.pageNumber,
        content: p.content,
        wordCount: p.content.split(/\s+/).filter(Boolean).length,
      }))

      const totalWords = pages.reduce((sum, p) => sum + p.wordCount, 0)

      return {
        pages,
        totalPages: pdfjsResult.totalPages,
        totalWords,
        metadata: {
          info: pdfjsResult.metadata,
          version: 'pdfjs-dist',
          parserUsed: 'pdfjs-dist',
        },
      }
    }

    console.log('[PDF Parser] pdfjs-dist extracted 0 chars, trying pdf-parse fallback')
  } catch (pdfjsError) {
    console.warn('[PDF Parser] pdfjs-dist failed, trying pdf-parse fallback:', pdfjsError)
  }

  // Fallback to pdf-parse
  return await extractWithPdfParse(pdfBuffer)
}

/**
 * Extract text using pdf-parse (fallback)
 */
async function extractWithPdfParse(pdfBuffer: Buffer): Promise<ParseResult> {
  console.log('[PDF Parser] Using pdf-parse')

  // Parse the PDF with custom page render function
  const data = await pdfParse(pdfBuffer, {
    pagerender: pageRenderFunction,
  })

  // Split content by page markers
  const pageContents = data.text.split(/\n--- PAGE \d+ ---\n/).filter(Boolean)

  const pages: ExtractedPage[] = pageContents.map((content, index) => {
    const cleanContent = content.trim()
    const wordCount = cleanContent.split(/\s+/).filter(Boolean).length

    return {
      pageNumber: index + 1,
      content: cleanContent,
      wordCount,
    }
  })

  // If page splitting didn't work, treat as single page
  if (pages.length === 0 && data.text.trim()) {
    const content = data.text.trim()
    pages.push({
      pageNumber: 1,
      content,
      wordCount: content.split(/\s+/).filter(Boolean).length,
    })
  }

  const totalWords = pages.reduce((sum, p) => sum + p.wordCount, 0)

  console.log(`[PDF Parser] pdf-parse extracted ${pages.length} pages, ${totalWords} words`)

  return {
    pages,
    totalPages: data.numpages || pages.length,
    totalWords,
    metadata: {
      info: data.info || {},
      version: data.version || 'unknown',
      parserUsed: 'pdf-parse',
    },
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
