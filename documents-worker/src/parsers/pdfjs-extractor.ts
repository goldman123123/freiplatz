/**
 * PDF extraction using pdfjs-dist
 *
 * Isolated module with proper Node 20 + TypeScript/ESM setup.
 * Better font encoding support than pdf-parse for complex PDFs.
 */

// @ts-ignore - pdfjs-dist ESM import doesn't have proper types for Node
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs'

// Disable web worker (not needed in Node.js)
GlobalWorkerOptions.workerSrc = ''

export interface PdfjsPage {
  pageNumber: number
  content: string
  charCount: number
}

export interface PdfjsResult {
  pages: PdfjsPage[]
  totalPages: number
  totalChars: number
  metadata: Record<string, unknown>
}

/**
 * Extract text from PDF buffer using pdfjs-dist
 *
 * @param pdfBuffer - PDF file as Buffer
 * @returns Extracted pages with content
 */
export async function extractWithPdfjs(pdfBuffer: Buffer): Promise<PdfjsResult> {
  console.log(`[pdfjs-dist] Parsing PDF (${pdfBuffer.length} bytes)`)

  // Convert Buffer to Uint8Array (required by pdfjs-dist)
  const data = new Uint8Array(pdfBuffer)

  // Load the PDF document
  const loadingTask = getDocument({
    data,
    // Disable external resources for security
    disableFontFace: true,
    // Use standard fonts if custom fonts fail
    useSystemFonts: true,
  })

  const doc = await loadingTask.promise
  const pages: PdfjsPage[] = []

  console.log(`[pdfjs-dist] Document has ${doc.numPages} pages`)

  // Extract text from each page
  for (let i = 1; i <= doc.numPages; i++) {
    try {
      const page = await doc.getPage(i)
      const textContent = await page.getTextContent()

      // Extract text items and join with spaces
      // Handle different item types (text items have 'str' property)
      const text = textContent.items
        .map((item: unknown) => {
          const textItem = item as { str?: string }
          return textItem.str || ''
        })
        .join(' ')
        // Normalize whitespace
        .replace(/\s+/g, ' ')
        .trim()

      pages.push({
        pageNumber: i,
        content: text,
        charCount: text.length,
      })

      // Log progress for long documents
      if (doc.numPages > 10 && i % 10 === 0) {
        console.log(`[pdfjs-dist] Processed ${i}/${doc.numPages} pages`)
      }
    } catch (pageError) {
      console.warn(`[pdfjs-dist] Error extracting page ${i}:`, pageError)
      pages.push({
        pageNumber: i,
        content: '',
        charCount: 0,
      })
    }
  }

  // Get metadata
  let metadata: Record<string, unknown> = {}
  try {
    const metadataResult = await doc.getMetadata()
    metadata = (metadataResult?.info as Record<string, unknown>) || {}
  } catch {
    // Metadata extraction is optional
  }

  const totalChars = pages.reduce((sum, p) => sum + p.charCount, 0)

  console.log(`[pdfjs-dist] Extracted ${totalChars} chars from ${pages.length} pages`)

  return {
    pages,
    totalPages: doc.numPages,
    totalChars,
    metadata,
  }
}
