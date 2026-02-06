/**
 * GET /api/documents
 *
 * List all documents for a business
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { documents, documentVersions, ingestionJobs } from '@/lib/db/schema'
import { requireBusinessAccess } from '@/lib/auth-helpers'
import { eq, and, desc, ne } from 'drizzle-orm'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const businessId = searchParams.get('businessId')
    const status = searchParams.get('status') || 'active'
    const limit = parseInt(searchParams.get('limit') || '50', 10)
    const offset = parseInt(searchParams.get('offset') || '0', 10)

    if (!businessId) {
      return NextResponse.json(
        { error: 'businessId query parameter is required' },
        { status: 400 }
      )
    }

    // Verify user has access to this business
    await requireBusinessAccess(businessId)

    // Build status filter
    const statusFilter = status === 'all'
      ? ne(documents.status, 'deleted')
      : eq(documents.status, status)

    // Get documents with latest version info
    const docs = await db
      .select({
        id: documents.id,
        title: documents.title,
        originalFilename: documents.originalFilename,
        status: documents.status,
        uploadedBy: documents.uploadedBy,
        labels: documents.labels,
        createdAt: documents.createdAt,
        updatedAt: documents.updatedAt,
      })
      .from(documents)
      .where(
        and(
          eq(documents.businessId, businessId),
          statusFilter
        )
      )
      .orderBy(desc(documents.createdAt))
      .limit(limit)
      .offset(offset)

    // Get version and job info for each document
    const documentsWithDetails = await Promise.all(
      docs.map(async (doc) => {
        // Get latest version
        const latestVersion = await db
          .select({
            id: documentVersions.id,
            version: documentVersions.version,
            fileSize: documentVersions.fileSize,
            createdAt: documentVersions.createdAt,
          })
          .from(documentVersions)
          .where(eq(documentVersions.documentId, doc.id))
          .orderBy(desc(documentVersions.version))
          .limit(1)
          .then(rows => rows[0])

        // Get latest job status
        let jobStatus = null
        if (latestVersion) {
          const job = await db
            .select({
              id: ingestionJobs.id,
              status: ingestionJobs.status,
              attempts: ingestionJobs.attempts,
              lastError: ingestionJobs.lastError,
              completedAt: ingestionJobs.completedAt,
            })
            .from(ingestionJobs)
            .where(eq(ingestionJobs.documentVersionId, latestVersion.id))
            .orderBy(desc(ingestionJobs.createdAt))
            .limit(1)
            .then(rows => rows[0])

          if (job) {
            jobStatus = {
              id: job.id,
              status: job.status,
              attempts: job.attempts,
              lastError: job.lastError,
              completedAt: job.completedAt,
            }
          }
        }

        return {
          ...doc,
          latestVersion: latestVersion ? {
            id: latestVersion.id,
            version: latestVersion.version,
            fileSize: latestVersion.fileSize,
            createdAt: latestVersion.createdAt,
          } : null,
          processingStatus: jobStatus,
        }
      })
    )

    return NextResponse.json({
      documents: documentsWithDetails,
      pagination: {
        limit,
        offset,
        hasMore: docs.length === limit,
      },
    })
  } catch (error) {
    console.error('[GET /api/documents] Error:', error)

    if (error instanceof Error) {
      if (error.message.includes('Unauthorized')) {
        return NextResponse.json({ error: error.message }, { status: 401 })
      }
      if (error.message.includes('Access denied')) {
        return NextResponse.json({ error: error.message }, { status: 403 })
      }
    }

    return NextResponse.json(
      { error: 'Failed to list documents' },
      { status: 500 }
    )
  }
}
