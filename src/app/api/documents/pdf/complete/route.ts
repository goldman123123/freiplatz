/**
 * POST /api/documents/pdf/complete
 *
 * Mark PDF upload as complete:
 * 1. Verify file exists in R2
 * 2. Update document version with file size and hash
 * 3. Update ingestion job status to 'uploaded' (visible to worker)
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { documentVersions, ingestionJobs, documents } from '@/lib/db/schema'
import { requireBusinessAccess } from '@/lib/auth-helpers'
import { fileExists } from '@/lib/r2/client'
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'

const completeSchema = z.object({
  businessId: z.string().uuid(),
  versionId: z.string().uuid(),
  fileSize: z.number().int().positive().optional(),
  sha256Hash: z.string().optional(),
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const data = completeSchema.parse(body)

    // Verify user has access to this business
    await requireBusinessAccess(data.businessId)

    // Get the document version
    const version = await db
      .select({
        id: documentVersions.id,
        documentId: documentVersions.documentId,
        r2Key: documentVersions.r2Key,
      })
      .from(documentVersions)
      .where(eq(documentVersions.id, data.versionId))
      .limit(1)
      .then(rows => rows[0])

    if (!version) {
      return NextResponse.json(
        { error: 'Document version not found' },
        { status: 404 }
      )
    }

    // Verify the document belongs to this business
    const document = await db
      .select({ businessId: documents.businessId })
      .from(documents)
      .where(eq(documents.id, version.documentId))
      .limit(1)
      .then(rows => rows[0])

    if (!document || document.businessId !== data.businessId) {
      return NextResponse.json(
        { error: 'Document not found or access denied' },
        { status: 404 }
      )
    }

    // Verify file exists in R2
    const exists = await fileExists(version.r2Key)
    if (!exists) {
      return NextResponse.json(
        { error: 'File not found in storage. Please upload the file first.' },
        { status: 400 }
      )
    }

    // Update document version with file metadata
    const updates: Partial<typeof documentVersions.$inferInsert> = {}
    if (data.fileSize) updates.fileSize = data.fileSize
    if (data.sha256Hash) updates.sha256Hash = data.sha256Hash

    if (Object.keys(updates).length > 0) {
      await db
        .update(documentVersions)
        .set(updates)
        .where(eq(documentVersions.id, data.versionId))
    }

    // Update ingestion job stage to 'uploaded' (makes it visible to worker)
    const [updatedJob] = await db
      .update(ingestionJobs)
      .set({
        status: 'queued',
        stage: 'uploaded',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(ingestionJobs.documentVersionId, data.versionId),
          eq(ingestionJobs.businessId, data.businessId)
        )
      )
      .returning()

    if (!updatedJob) {
      return NextResponse.json(
        { error: 'Ingestion job not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      jobId: updatedJob.id,
      status: updatedJob.status,
      stage: 'uploaded',
      message: 'Upload complete. Processing will begin shortly.',
    })
  } catch (error) {
    console.error('[POST /api/documents/pdf/complete] Error:', error)

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
        return NextResponse.json({ error: error.message }, { status: 403 }
        )
      }
    }

    return NextResponse.json(
      { error: 'Failed to complete upload' },
      { status: 500 }
    )
  }
}
