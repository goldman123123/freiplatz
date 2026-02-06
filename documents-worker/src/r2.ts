/**
 * R2 Client for downloading PDFs
 */

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'hebelki'

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
  throw new Error('R2 credentials are required. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY')
}

// EU jurisdiction endpoint
const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.eu.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
})

/**
 * Download file from R2 as Buffer
 */
export async function downloadFromR2(r2Key: string): Promise<Buffer> {
  console.log(`[R2] Downloading: ${r2Key}`)

  const command = new GetObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: r2Key,
  })

  const response = await r2Client.send(command)

  if (!response.Body) {
    throw new Error(`Failed to download file: ${r2Key}`)
  }

  // Convert stream to buffer
  const chunks: Uint8Array[] = []
  const reader = response.Body.transformToWebStream().getReader()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }

  const buffer = Buffer.concat(chunks)
  console.log(`[R2] Downloaded ${buffer.length} bytes`)

  return buffer
}

export { r2Client, R2_BUCKET_NAME }
