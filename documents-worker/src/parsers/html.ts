/**
 * HTML Parser
 *
 * Uses cheerio to parse HTML and extract text content.
 * Strips scripts, styles, navigation, and other non-content elements.
 */

import * as cheerio from 'cheerio'
import type { ParsedDocument } from '../parser-router.js'

// Characters per logical page (for chunking consistency)
const CHARS_PER_PAGE = 5000

/**
 * Extract text from HTML buffer
 *
 * Removes non-content elements and extracts clean text.
 * Preserves some structure via whitespace.
 *
 * @param buffer - HTML file as Buffer (UTF-8)
 * @returns Normalized parsed document
 */
export async function extractWithHtml(buffer: Buffer): Promise<ParsedDocument> {
  console.log(`[HTML] Parsing HTML (${buffer.length} bytes)`)

  const html = buffer.toString('utf-8')
  const $ = cheerio.load(html)

  // Extract title before removing elements
  const title = $('title').text().trim() || $('h1').first().text().trim() || ''

  // Remove non-content elements
  $('script').remove()
  $('style').remove()
  $('noscript').remove()
  $('iframe').remove()
  $('svg').remove()
  $('nav').remove()
  $('footer').remove()
  $('header').remove()
  $('aside').remove()
  $('[role="navigation"]').remove()
  $('[role="banner"]').remove()
  $('[role="contentinfo"]').remove()
  $('form').remove()
  $('input').remove()
  $('button').remove()

  // Get main content or body
  let content = ''
  const main = $('main, article, [role="main"]')
  if (main.length > 0) {
    content = main.text()
  } else {
    content = $('body').text() || $.text()
  }

  // Normalize whitespace while preserving paragraph breaks
  content = content
    .replace(/\t/g, ' ')
    .replace(/[ ]+/g, ' ')
    .replace(/\n[ ]+/g, '\n')
    .replace(/[ ]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  if (!content) {
    console.log('[HTML] No text content extracted')
    return {
      pages: [],
      totalPages: 0,
      totalChars: 0,
      totalWords: 0,
      metadata: {
        title,
        originalLength: html.length,
      },
      parserUsed: 'html',
    }
  }

  // Split into logical pages by character count
  const pages: Array<{ pageNumber: number; content: string }> = []

  for (let i = 0; i < content.length; i += CHARS_PER_PAGE) {
    let pageContent = content.slice(i, i + CHARS_PER_PAGE)

    // Try to break at a paragraph boundary
    if (i + CHARS_PER_PAGE < content.length) {
      const lastParagraph = pageContent.lastIndexOf('\n\n')
      if (lastParagraph > CHARS_PER_PAGE * 0.7) {
        pageContent = pageContent.slice(0, lastParagraph)
        i = i - (CHARS_PER_PAGE - lastParagraph) + 2 // Adjust for next iteration
      }
    }

    pageContent = pageContent.trim()
    if (pageContent) {
      pages.push({
        pageNumber: pages.length + 1,
        content: pageContent,
      })
    }
  }

  // If no pages created, use single page
  if (pages.length === 0 && content) {
    pages.push({
      pageNumber: 1,
      content,
    })
  }

  const totalChars = content.length
  const totalWords = content.split(/\s+/).filter(Boolean).length

  console.log(`[HTML] Extracted ${pages.length} pages, ${totalWords} words, title: "${title.slice(0, 50)}"`)

  return {
    pages,
    totalPages: pages.length,
    totalChars,
    totalWords,
    metadata: {
      title,
      originalLength: html.length,
      compressionRatio: content.length / html.length,
    },
    parserUsed: 'html',
  }
}
