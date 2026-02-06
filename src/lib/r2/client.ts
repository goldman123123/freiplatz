/**
 * Cloudflare R2 Client for Document Storage
 *
 * Uses AWS S3-compatible SDK to interact with R2.
 * Handles presigned URLs for secure uploads/downloads.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

// Environment validation
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'hebelki'

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
  console.warn(
    'R2 credentials not configured. Document upload/download will fail. ' +
    'Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY in .env.local'
  )
}

// S3-compatible client for Cloudflare R2 (EU jurisdiction)
const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.eu.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID || '',
    secretAccessKey: R2_SECRET_ACCESS_KEY || '',
  },
})

/**
 * Generate deterministic R2 key for a document version
 * Format: tenant/{businessId}/documents/{docId}/v{version}/raw.pdf
 */
export function generateR2Key(
  businessId: string,
  documentId: string,
  version: number
): string {
  return `tenant/${businessId}/documents/${documentId}/v${version}/raw.pdf`
}

/**
 * Generate presigned URL for uploading a PDF to R2
 *
 * @param r2Key - The storage key (use generateR2Key)
 * @param contentType - MIME type (default: application/pdf)
 * @param expiresIn - URL expiration in seconds (default: 15 minutes)
 * @returns Presigned PUT URL
 */
export async function getUploadUrl(
  r2Key: string,
  contentType: string = 'application/pdf',
  expiresIn: number = 900 // 15 minutes
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: r2Key,
    ContentType: contentType,
  })

  const signedUrl = await getSignedUrl(r2Client, command, { expiresIn })
  return signedUrl
}

/**
 * Generate presigned URL for downloading a PDF from R2
 *
 * @param r2Key - The storage key
 * @param expiresIn - URL expiration in seconds (default: 1 hour)
 * @returns Presigned GET URL
 */
export async function getDownloadUrl(
  r2Key: string,
  expiresIn: number = 3600 // 1 hour
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: r2Key,
  })

  const signedUrl = await getSignedUrl(r2Client, command, { expiresIn })
  return signedUrl
}

/**
 * Download file content from R2 as Buffer
 * Used by the worker to process PDFs
 *
 * @param r2Key - The storage key
 * @returns File content as Buffer
 */
export async function downloadFile(r2Key: string): Promise<Buffer> {
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

  return Buffer.concat(chunks)
}

/**
 * Check if a file exists in R2
 *
 * @param r2Key - The storage key
 * @returns true if file exists, false otherwise
 */
export async function fileExists(r2Key: string): Promise<boolean> {
  try {
    const command = new HeadObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: r2Key,
    })

    await r2Client.send(command)
    return true
  } catch {
    return false
  }
}

/**
 * Delete a file from R2
 *
 * @param r2Key - The storage key
 */
export async function deleteFile(r2Key: string): Promise<void> {
  const command = new DeleteObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: r2Key,
  })

  await r2Client.send(command)
}

/**
 * Delete all versions of a document from R2
 * Deletes all files under: tenant/{businessId}/documents/{docId}/
 *
 * @param businessId - Business ID
 * @param documentId - Document ID
 * @param versions - Array of version numbers to delete
 */
export async function deleteDocumentVersions(
  businessId: string,
  documentId: string,
  versions: number[]
): Promise<void> {
  const deletePromises = versions.map(version => {
    const r2Key = generateR2Key(businessId, documentId, version)
    return deleteFile(r2Key)
  })

  await Promise.all(deletePromises)
}

export { r2Client, R2_BUCKET_NAME }
