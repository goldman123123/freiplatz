/**
 * XLSX Parser
 *
 * Uses SheetJS (xlsx) to parse Excel spreadsheets.
 * Handles both .xlsx and legacy .xls formats.
 * Each sheet becomes a logical page.
 */

import * as XLSX from 'xlsx'
import type { ParsedDocument } from '../parser-router.js'

// Guard against huge files
const MAX_ROWS_PER_SHEET = 5000

/**
 * Extract text from Excel buffer
 *
 * Converts spreadsheet data into readable text format.
 * Each sheet becomes a separate page with header row as keys.
 *
 * @param buffer - Excel file as Buffer
 * @returns Normalized parsed document
 */
export async function extractWithXlsx(buffer: Buffer): Promise<ParsedDocument> {
  console.log(`[XLSX] Parsing Excel (${buffer.length} bytes)`)

  // Read workbook from buffer
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    cellDates: true, // Parse dates properly
    cellNF: false, // Don't include number formats
    cellText: true, // Generate text for formulas
  })

  const pages: Array<{ pageNumber: number; content: string }> = []
  let totalChars = 0
  let totalWords = 0
  let pageNumber = 1
  const sheetInfo: Record<string, { rows: number; truncated: boolean }> = {}

  // Process each sheet
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]

    // Convert sheet to array of arrays (first row is headers)
    const data = XLSX.utils.sheet_to_json<string[]>(sheet, {
      header: 1, // Array of arrays
      defval: '', // Default empty string for empty cells
      blankrows: false, // Skip blank rows
    })

    if (data.length === 0) {
      console.log(`[XLSX] Sheet "${sheetName}" is empty, skipping`)
      continue
    }

    // Limit rows for safety
    const truncated = data.length > MAX_ROWS_PER_SHEET
    const rows = truncated ? data.slice(0, MAX_ROWS_PER_SHEET) : data

    // First row is headers
    const headers = rows[0] || []
    const dataRows = rows.slice(1)

    if (dataRows.length === 0) {
      console.log(`[XLSX] Sheet "${sheetName}" has only headers, skipping`)
      continue
    }

    // Convert rows to readable format (similar to CSV)
    const rowTexts = dataRows.map(row => {
      return headers
        .map((h, i) => {
          const header = String(h).trim()
          const value = String(row[i] || '').trim()
          return value ? `${header}: ${value}` : null
        })
        .filter(Boolean)
        .join(' | ')
    }).filter(line => line.length > 0)

    if (rowTexts.length === 0) {
      continue
    }

    // Combine into page content with sheet name header
    const content = `[Sheet: ${sheetName}]\n${rowTexts.join('\n')}`

    pages.push({
      pageNumber,
      content,
    })

    totalChars += content.length
    totalWords += content.split(/\s+/).filter(Boolean).length
    pageNumber++

    sheetInfo[sheetName] = {
      rows: dataRows.length,
      truncated,
    }

    console.log(`[XLSX] Sheet "${sheetName}": ${dataRows.length} rows${truncated ? ' (TRUNCATED)' : ''}`)
  }

  console.log(`[XLSX] Extracted ${pages.length} sheets, ${totalWords} words from ${workbook.SheetNames.length} total sheets`)

  return {
    pages,
    totalPages: pages.length,
    totalChars,
    totalWords,
    metadata: {
      sheetCount: workbook.SheetNames.length,
      sheetNames: workbook.SheetNames,
      processedSheets: Object.keys(sheetInfo).length,
      sheetInfo,
    },
    parserUsed: 'xlsx',
  }
}
