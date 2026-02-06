/**
 * POST /api/documents/pdf/init
 *
 * Initialize a PDF upload:
 * 1. Create document record
 * 2. Create document version record
 * 3. Create ingestion job (status: pending_upload)
 * 4. Generate and return presigned upload URL
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { documents, documentVersions, ingestionJobs } from '@/lib/db/schema'
import { requireBusinessAccess, requireAuth } from '@/lib/auth-helpers'
import { generateR2Key, getUploadUrl } from '@/lib/r2/client'
import { z } from 'zod'

const initSchema = z.object({
  businessId: z.string().uuid(),
  title: z.string().min(1).max(255),
  filename: z.string().min(1).max(255),
  contentType: z.string().default('application/pdf'),
})

export async function POST(request: NextRequest) {
  try {
    const userId = await requireAuth()
    const body = await request.json()
    const data = initSchema.parse(body)

    // Verify user has access to this business
    await requireBusinessAccess(data.businessId)

    // Validate content type
    if (!data.contentType.includes('pdf')) {
      return NextResponse.json(
        { error: 'Only PDF files are supported' },
        { status: 400 }
      )
    }

    // Create document record
    const [document] = await db
      .insert(documents)
      .values({
        businessId: data.businessId,
        title: data.title,
        originalFilename: data.filename,
        uploadedBy: userId,
        status: 'active',
      })
      .returning()

    // Generate R2 key for version 1
    const r2Key = generateR2Key(data.businessId, document.id, 1)

    // Create document version record
    const [version] = await db
      .insert(documentVersions)
      .values({
        documentId: document.id,
        version: 1,
        r2Key,
        mimeType: data.contentType,
      })
      .returning()

    // Create ingestion job (queued, waiting for upload)
    const [job] = await db
      .insert(ingestionJobs)
      .values({
        documentVersionId: version.id,
        businessId: data.businessId,
        sourceType: 'pdf',
        status: 'queued',
        stage: 'pending_upload',
        metrics: {
          initiatedBy: userId,
          filename: data.filename,
        },
      })
      .returning()

    // Generate presigned upload URL (15 minutes expiry)
    const uploadUrl = await getUploadUrl(r2Key, data.contentType, 900)

    return NextResponse.json({
      documentId: document.id,
      versionId: version.id,
      jobId: job.id,
      r2Key,
      uploadUrl,
      expiresIn: 900, // seconds
    })
  } catch (error) {
    console.error('[POST /api/documents/pdf/init] Error:', error)

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request', details: error.issues },
        { status: 400 }
      )
    }

    if (error instanceof Error) {
      if (error.message.includes('Unauthorized')) {
        return NextResponse.json({ error: error.message }, { status: 401 })
      }
      if (error.message.includes('Access denied')) {
        return NextResponse.json({ error: error.message }, { status: 403 })
      }
    }

    return NextResponse.json(
      { error: 'Failed to initialize upload' },
      { status: 500 }
    )
  }
}
