/**
 * CSV Parser
 *
 * Uses papaparse to parse CSV files into readable text.
 * Converts rows into key-value format for better searchability.
 */

import Papa from 'papaparse'
import type { ParsedDocument } from '../parser-router.js'

// Guard against huge files
const MAX_ROWS = 10000

// Rows per logical page (for chunking consistency)
const ROWS_PER_PAGE = 100

/**
 * Extract text from CSV buffer
 *
 * Converts CSV rows into readable text format:
 * "Column1: value1 | Column2: value2 | ..."
 *
 * @param buffer - CSV file as Buffer (UTF-8)
 * @returns Normalized parsed document
 */
export async function extractWithCsv(buffer: Buffer): Promise<ParsedDocument> {
  console.log(`[CSV] Parsing CSV (${buffer.length} bytes)`)

  const csvText = buffer.toString('utf-8')

  // Parse CSV with headers
  const result = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
    preview: MAX_ROWS, // Limit rows for safety
    transformHeader: (h: string) => h.trim(), // Clean header names
  })

  // Log parse errors (but don't fail - partial data is ok)
  if (result.errors.length > 0) {
    console.warn(`[CSV] ${result.errors.length} parse warnings:`, result.errors.slice(0, 3))
  }

  const rows = result.data as Record<string, string>[]
  const headers = result.meta.fields || []

  if (rows.length === 0) {
    console.log('[CSV] No data rows found')
    return {
      pages: [],
      totalPages: 0,
      totalChars: 0,
      totalWords: 0,
      metadata: {
        columns: headers,
        parseErrors: result.errors.slice(0, 5),
      },
      parserUsed: 'csv',
    }
  }

  // Convert rows to readable text blocks (pages)
  const pages: Array<{ pageNumber: number; content: string }> = []

  for (let i = 0; i < rows.length; i += ROWS_PER_PAGE) {
    const pageRows = rows.slice(i, i + ROWS_PER_PAGE)

    // Convert each row to a readable line
    const content = pageRows
      .map(row => {
        return headers
          .map(h => {
            const value = row[h]?.toString().trim() || ''
            return value ? `${h}: ${value}` : null
          })
          .filter(Boolean)
          .join(' | ')
      })
      .filter(line => line.length > 0)
      .join('\n')

    if (content) {
      pages.push({
        pageNumber: Math.floor(i / ROWS_PER_PAGE) + 1,
        content,
      })
    }
  }

  const totalChars = pages.reduce((sum, p) => sum + p.content.length, 0)
  const totalWords = pages.reduce((sum, p) => {
    return sum + p.content.split(/\s+/).filter(Boolean).length
  }, 0)

  const truncated = rows.length >= MAX_ROWS

  console.log(`[CSV] Extracted ${pages.length} pages, ${rows.length} rows, ${headers.length} columns${truncated ? ' (TRUNCATED)' : ''}`)

  return {
    pages,
    totalPages: pages.length,
    totalChars,
    totalWords,
    metadata: {
      rowCount: rows.length,
      columnCount: headers.length,
      columns: headers,
      truncated,
      parseErrors: result.errors.length > 0 ? result.errors.slice(0, 5) : undefined,
    },
    parserUsed: 'csv',
  }
}
