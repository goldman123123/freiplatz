/**
 * Shared PDF Generation Utility
 *
 * Generates PDFs from HTML using Puppeteer.
 * Used by both invoice and Lieferschein generation.
 *
 * On Vercel: uses @sparticuz/chromium-min (downloads Chrome from CDN at runtime)
 * Locally: uses regular puppeteer (bundled Chromium)
 */

export async function generatePdfFromHtml(html: string): Promise<Buffer> {
  const isVercel = !!process.env.VERCEL || process.env.NODE_ENV === 'production'
  let browser

  if (isVercel) {
    const chromium = (await import('@sparticuz/chromium-min')).default
    const puppeteerCore = (await import('puppeteer-core')).default
    browser = await puppeteerCore.launch({
      args: chromium.args,
      defaultViewport: { width: 1200, height: 800 },
      executablePath: await chromium.executablePath(
        'https://github.com/Sparticuz/chromium/releases/download/v143.0.0/chromium-v143.0.0-pack.x64.tar'
      ),
      headless: true,
    })
  } else {
    const puppeteer = (await import('puppeteer')).default
    browser = await puppeteer.launch({ headless: true })
  }

  const page = await browser.newPage()
  await page.setContent(html, { waitUntil: 'networkidle0' })

  const pdfBuffer = await page.pdf({
    format: 'A4',
    printBackground: true,
    margin: {
      top: '20mm',
      right: '15mm',
      bottom: '20mm',
      left: '15mm',
    },
  })

  await browser.close()
  return Buffer.from(pdfBuffer)
}
