/**
 * GET/DELETE /api/documents/[id]
 *
 * Get document details or mark for deletion
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  documents,
  documentVersions,
  ingestionJobs,
  documentPages,
  documentChunks,
  chunkEmbeddings,
} from '@/lib/db/schema'
import { requireBusinessAccess } from '@/lib/auth-helpers'
import { getDownloadUrl } from '@/lib/r2/client'
import { eq, and, desc } from 'drizzle-orm'

type Params = Promise<{ id: string }>

/**
 * GET /api/documents/[id]
 * Get document details including all versions
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Params }
) {
  try {
    const { id: documentId } = await params
    const searchParams = request.nextUrl.searchParams
    const businessId = searchParams.get('businessId')

    if (!businessId) {
      return NextResponse.json(
        { error: 'businessId query parameter is required' },
        { status: 400 }
      )
    }

    // Verify user has access to this business
    await requireBusinessAccess(businessId)

    // Get document
    const doc = await db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.id, documentId),
          eq(documents.businessId, businessId)
        )
      )
      .limit(1)
      .then(rows => rows[0])

    if (!doc) {
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      )
    }

    // Get all versions
    const versions = await db
      .select({
        id: documentVersions.id,
        version: documentVersions.version,
        r2Key: documentVersions.r2Key,
        fileSize: documentVersions.fileSize,
        mimeType: documentVersions.mimeType,
        sha256Hash: documentVersions.sha256Hash,
        createdAt: documentVersions.createdAt,
      })
      .from(documentVersions)
      .where(eq(documentVersions.documentId, documentId))
      .orderBy(desc(documentVersions.version))

    // Get latest version's job status and generate download URL
    let downloadUrl: string | null = null
    let latestJob = null

    if (versions.length > 0) {
      const latestVersion = versions[0]

      // Generate presigned download URL (1 hour expiry)
      downloadUrl = await getDownloadUrl(latestVersion.r2Key, 3600)

      // Get job status
      const job = await db
        .select({
          id: ingestionJobs.id,
          status: ingestionJobs.status,
          stage: ingestionJobs.stage,
          errorCode: ingestionJobs.errorCode,
          attempts: ingestionJobs.attempts,
          lastError: ingestionJobs.lastError,
          metrics: ingestionJobs.metrics,
          startedAt: ingestionJobs.startedAt,
          completedAt: ingestionJobs.completedAt,
          createdAt: ingestionJobs.createdAt,
        })
        .from(ingestionJobs)
        .where(eq(ingestionJobs.documentVersionId, latestVersion.id))
        .orderBy(desc(ingestionJobs.createdAt))
        .limit(1)
        .then(rows => rows[0])

      if (job) {
        latestJob = job
      }
    }

    // Get chunk count for latest version
    let chunkCount = 0
    let pageCount = 0
    if (versions.length > 0) {
      const latestVersion = versions[0]

      const chunks = await db
        .select({ id: documentChunks.id })
        .from(documentChunks)
        .where(eq(documentChunks.documentVersionId, latestVersion.id))

      chunkCount = chunks.length

      const pages = await db
        .select({ id: documentPages.id })
        .from(documentPages)
        .where(eq(documentPages.documentVersionId, latestVersion.id))

      pageCount = pages.length
    }

    return NextResponse.json({
      id: doc.id,
      title: doc.title,
      originalFilename: doc.originalFilename,
      status: doc.status,
      uploadedBy: doc.uploadedBy,
      labels: doc.labels,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      versions: versions.map(v => ({
        id: v.id,
        version: v.version,
        fileSize: v.fileSize,
        mimeType: v.mimeType,
        createdAt: v.createdAt,
      })),
      downloadUrl,
      processingStatus: latestJob,
      stats: {
        pageCount,
        chunkCount,
        versionCount: versions.length,
      },
    })
  } catch (error) {
    console.error('[GET /api/documents/[id]] Error:', error)

    if (error instanceof Error) {
      if (error.message.includes('Unauthorized')) {
        return NextResponse.json({ error: error.message }, { status: 401 })
      }
      if (error.message.includes('Access denied')) {
        return NextResponse.json({ error: error.message }, { status: 403 })
      }
    }

    return NextResponse.json(
      { error: 'Failed to get document' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/documents/[id]
 * Mark document for deletion (two-phase delete)
 *
 * Phase 1: Mark as deleted_pending (API does this)
 * Phase 2: Worker cleans up R2 + DB rows, marks as deleted
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Params }
) {
  try {
    const { id: documentId } = await params
    const searchParams = request.nextUrl.searchParams
    const businessId = searchParams.get('businessId')

    if (!businessId) {
      return NextResponse.json(
        { error: 'businessId query parameter is required' },
        { status: 400 }
      )
    }

    // Verify user has access to this business
    await requireBusinessAccess(businessId)

    // Get document
    const doc = await db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.id, documentId),
          eq(documents.businessId, businessId)
        )
      )
      .limit(1)
      .then(rows => rows[0])

    if (!doc) {
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      )
    }

    // Already deleted or pending deletion
    if (doc.status === 'deleted' || doc.status === 'deleted_pending') {
      return NextResponse.json({
        success: true,
        status: doc.status,
        message: doc.status === 'deleted'
          ? 'Document already deleted'
          : 'Document deletion in progress',
      })
    }

    // Phase 1: Mark as deleted_pending
    await db
      .update(documents)
      .set({
        status: 'deleted_pending',
        updatedAt: new Date(),
        deletedAt: new Date(),
      })
      .where(eq(documents.id, documentId))

    // Cancel any pending/in-progress jobs
    const versions = await db
      .select({ id: documentVersions.id })
      .from(documentVersions)
      .where(eq(documentVersions.documentId, documentId))

    for (const version of versions) {
      await db
        .update(ingestionJobs)
        .set({
          status: 'failed',
          errorCode: 'document_deleted',
          lastError: 'Document deleted',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(ingestionJobs.documentVersionId, version.id),
            // Only cancel jobs that aren't already done/failed
            eq(ingestionJobs.status, 'queued')
          )
        )
    }

    return NextResponse.json({
      success: true,
      status: 'deleted_pending',
      message: 'Document marked for deletion. Cleanup will complete shortly.',
    })
  } catch (error) {
    console.error('[DELETE /api/documents/[id]] Error:', error)

    if (error instanceof Error) {
      if (error.message.includes('Unauthorized')) {
        return NextResponse.json({ error: error.message }, { status: 401 })
      }
      if (error.message.includes('Access denied')) {
        return NextResponse.json({ error: error.message }, { status: 403 })
      }
    }

    return NextResponse.json(
      { error: 'Failed to delete document' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/documents/[id]
 * Update document metadata (title, labels)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Params }
) {
  try {
    const { id: documentId } = await params
    const body = await request.json()
    const { businessId, title, labels } = body

    if (!businessId) {
      return NextResponse.json(
        { error: 'businessId is required' },
        { status: 400 }
      )
    }

    // Verify user has access to this business
    await requireBusinessAccess(businessId)

    // Get document
    const doc = await db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.id, documentId),
          eq(documents.businessId, businessId)
        )
      )
      .limit(1)
      .then(rows => rows[0])

    if (!doc) {
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      )
    }

    // Build update object
    const updates: Partial<typeof documents.$inferInsert> = {
      updatedAt: new Date(),
    }

    if (title !== undefined) {
      updates.title = title
    }

    if (labels !== undefined) {
      updates.labels = labels
    }

    // Update document
    const [updated] = await db
      .update(documents)
      .set(updates)
      .where(eq(documents.id, documentId))
      .returning()

    return NextResponse.json({
      id: updated.id,
      title: updated.title,
      labels: updated.labels,
      updatedAt: updated.updatedAt,
    })
  } catch (error) {
    console.error('[PATCH /api/documents/[id]] Error:', error)

    if (error instanceof Error) {
      if (error.message.includes('Unauthorized')) {
        return NextResponse.json({ error: error.message }, { status: 401 })
      }
      if (error.message.includes('Access denied')) {
        return NextResponse.json({ error: error.message }, { status: 403 })
      }
    }

    return NextResponse.json(
      { error: 'Failed to update document' },
      { status: 500 }
    )
  }
}
