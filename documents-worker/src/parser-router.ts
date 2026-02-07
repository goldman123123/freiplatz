/**
 * Parser Router - Routes documents to appropriate parsers by MIME type
 *
 * Maintains a single pipeline by normalizing all parser outputs to the same format.
 * Supports: PDF, DOCX, TXT, CSV, XLSX, HTML
 */

import { extractWithPdf } from './parsers/pdf.js'
import { extractWithDocx } from './parsers/docx.js'
import { extractWithTxt } from './parsers/txt.js'
import { extractWithCsv } from './parsers/csv.js'
import { extractWithXlsx } from './parsers/xlsx.js'
import { extractWithHtml } from './parsers/html.js'

/**
 * Normalized output from all parsers
 * Every parser must return this exact structure
 */
export interface ParsedDocument {
  pages: Array<{
    pageNumber: number
    content: string
  }>
  totalPages: number
  totalChars: number
  totalWords: number
  metadata: Record<string, unknown>
  parserUsed: string
}

/**
 * Parser function signature - all parsers must implement this
 */
type ParserFunction = (buffer: Buffer) => Promise<ParsedDocument>

/**
 * MIME type to parser mapping
 * Each MIME type maps to exactly one parser function
 */
const PARSER_MAP: Record<string, ParserFunction> = {
  // PDF
  'application/pdf': extractWithPdf,

  // DOCX (Word documents)
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': extractWithDocx,
  'application/msword': extractWithDocx, // Legacy .doc (mammoth handles both)

  // TXT (plain text)
  'text/plain': extractWithTxt,

  // CSV (comma-separated values)
  'text/csv': extractWithCsv,
  'application/csv': extractWithCsv,

  // XLSX (Excel spreadsheets)
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': extractWithXlsx,
  'application/vnd.ms-excel': extractWithXlsx, // Legacy .xls

  // HTML
  'text/html': extractWithHtml,
  'application/xhtml+xml': extractWithHtml,
}

/**
 * Source type to MIME fallback
 * Used when job has source_type but no mime_type
 */
const SOURCE_TYPE_FALLBACK: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  txt: 'text/plain',
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  html: 'text/html',
  htm: 'text/html',
}

/**
 * File extension to source type mapping
 * Used to infer source_type from filename
 */
export const EXTENSION_TO_SOURCE_TYPE: Record<string, string> = {
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.doc': 'doc',
  '.txt': 'txt',
  '.csv': 'csv',
  '.xlsx': 'xlsx',
  '.xls': 'xls',
  '.html': 'html',
  '.htm': 'html',
}

/**
 * Parse a document buffer using the appropriate parser
 *
 * @param buffer - File contents as Buffer
 * @param mimeType - MIME type of the file
 * @param sourceType - Optional source type (pdf, docx, etc.) as fallback
 * @returns Normalized parsed document
 * @throws Error if file type is not supported
 */
export async function parseDocument(
  buffer: Buffer,
  mimeType: string,
  sourceType?: string
): Promise<ParsedDocument> {
  // Try MIME type first
  let parser = PARSER_MAP[mimeType]

  // Fallback to source_type if MIME not found
  if (!parser && sourceType) {
    const fallbackMime = SOURCE_TYPE_FALLBACK[sourceType]
    if (fallbackMime) {
      parser = PARSER_MAP[fallbackMime]
      console.log(`[Parser Router] MIME ${mimeType} not found, falling back to source_type ${sourceType} (${fallbackMime})`)
    }
  }

  if (!parser) {
    throw new Error(`Unsupported file type: ${mimeType} (source_type: ${sourceType || 'none'})`)
  }

  console.log(`[Parser Router] Parsing ${mimeType} with ${sourceType || 'auto'} parser`)
  return parser(buffer)
}

/**
 * Check if a file type is supported
 *
 * @param mimeType - MIME type to check
 * @param sourceType - Optional source type as fallback
 * @returns true if file type can be parsed
 */
export function isSupported(mimeType: string, sourceType?: string): boolean {
  if (PARSER_MAP[mimeType]) return true
  if (sourceType && SOURCE_TYPE_FALLBACK[sourceType]) return true
  return false
}

/**
 * Get list of supported MIME types
 */
export function getSupportedMimeTypes(): string[] {
  return Object.keys(PARSER_MAP)
}

/**
 * Get list of supported source types
 */
export function getSupportedSourceTypes(): string[] {
  return Object.keys(SOURCE_TYPE_FALLBACK)
}
