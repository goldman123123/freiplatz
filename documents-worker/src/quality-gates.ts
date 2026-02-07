/**
 * Quality Gates for PDF Extraction
 *
 * Page-count aware thresholds to avoid false positives on short documents
 * (e.g., single-page receipts are fine with low char counts)
 */

export interface NormalizedPage {
  pageNumber: number
  content: string  // Already normalized (trimmed, collapsed whitespace)
  charCount: number
}

export type ErrorCode =
  | 'extraction_empty'
  | 'extraction_low_quality'
  | 'needs_ocr'
  | 'parse_failed'
  | 'provider_rate_limited'
  | 'timeout'
  | 'unsupported_format'
  | 'file_too_large'
  | 'file_corrupted'

export interface QualityResult {
  passed: boolean
  issues: string[]
  errorCode?: ErrorCode
}

/**
 * Check extraction quality with page-count aware thresholds
 *
 * Call AFTER normalizing text (trim, collapse whitespace)
 *
 * @param pages - Array of normalized pages with content
 * @returns Quality check result with pass/fail and issues
 */
export function checkExtractionQuality(pages: NormalizedPage[]): QualityResult {
  const pageCount = pages.length
  const issues: string[] = []

  // Metric 1: Total extracted characters
  const totalChars = pages.reduce((sum, p) => sum + p.charCount, 0)

  // Metric 2: Non-empty pages ratio
  const nonEmptyPages = pages.filter(p => p.charCount > 10).length
  const nonEmptyRatio = pageCount > 0 ? nonEmptyPages / pageCount : 0

  // Metric 3: Average chars per page
  const avgCharsPerPage = pageCount > 0 ? totalChars / pageCount : 0

  console.log(`[Quality Gates] ${pageCount} pages, ${totalChars} chars, ${(nonEmptyRatio * 100).toFixed(0)}% non-empty, ${avgCharsPerPage.toFixed(0)} avg chars/page`)

  // Gate 1: Absolute zero extraction
  if (totalChars === 0) {
    return {
      passed: false,
      issues: ['No text extracted from any page'],
      errorCode: 'extraction_empty',
    }
  }

  // Gate 2: Needs OCR detection (multi-page + very low chars + low non-empty ratio)
  // Only flag as needs_ocr if:
  // - More than 1 page (single-page receipts/forms are ok)
  // - Total chars very low (< 100 total)
  // - Non-empty ratio very low (< 0.3)
  if (pageCount > 1 && totalChars < 100 && nonEmptyRatio < 0.3) {
    return {
      passed: false,
      issues: [
        `Likely scanned PDF: ${totalChars} chars total`,
        `Only ${(nonEmptyRatio * 100).toFixed(0)}% of pages have content`,
      ],
      errorCode: 'needs_ocr',
    }
  }

  // Gate 3: Page-count aware minimum thresholds
  // Single page: allow very low chars (receipts, forms, certificates)
  // Multi-page: expect more content
  const minTotalChars = pageCount === 1 ? 20 : pageCount * 50 // 50 chars/page avg for multi-page
  if (totalChars < minTotalChars) {
    issues.push(`Low extraction: ${totalChars} chars (expected ${minTotalChars}+ for ${pageCount} pages)`)
  }

  // Gate 4: Non-empty ratio (only for multi-page documents)
  // If more than half the pages are empty, something might be wrong
  if (pageCount > 3 && nonEmptyRatio < 0.5) {
    issues.push(`Only ${(nonEmptyRatio * 100).toFixed(0)}% of ${pageCount} pages have content`)
  }

  // Gate 5: Suspicious patterns (multi-page with extremely low avg)
  // Long document with < 20 chars/page average is suspicious
  if (pageCount > 5 && avgCharsPerPage < 20) {
    issues.push(`Very low content density: ${avgCharsPerPage.toFixed(0)} chars/page average`)
  }

  // Fail if multiple significant issues
  if (issues.length >= 2) {
    return {
      passed: false,
      issues,
      errorCode: 'extraction_low_quality',
    }
  }

  // Pass with warnings
  return {
    passed: true,
    issues, // May have 0 or 1 warning, still passed
  }
}

/**
 * Classify an error into an error code
 *
 * @param error - The error that occurred
 * @returns Error code for categorization
 */
export function classifyError(error: unknown): ErrorCode {
  const msg = String(error).toLowerCase()

  if (msg.includes('rate limit') || msg.includes('429') || msg.includes('too many')) {
    return 'provider_rate_limited'
  }

  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('aborted')) {
    return 'timeout'
  }

  if (msg.includes('invalid pdf') || msg.includes('corrupt') || msg.includes('bad xref')) {
    return 'file_corrupted'
  }

  if (msg.includes('unsupported') || msg.includes('unknown format') || msg.includes('not supported')) {
    return 'unsupported_format'
  }

  if (msg.includes('too large') || msg.includes('size limit') || msg.includes('memory')) {
    return 'file_too_large'
  }

  // Default to parse_failed for unknown errors
  return 'parse_failed'
}
