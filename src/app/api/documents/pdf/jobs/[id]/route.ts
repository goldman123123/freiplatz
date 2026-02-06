/**
 * GET /api/documents/pdf/jobs/[id]
 *
 * Get ingestion job status and progress
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ingestionJobs, documentVersions, documents } from '@/lib/db/schema'
import { requireBusinessAccess } from '@/lib/auth-helpers'
import { eq } from 'drizzle-orm'

type Params = Promise<{ id: string }>

export async function GET(
  request: NextRequest,
  { params }: { params: Params }
) {
  try {
    const { id: jobId } = await params
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

    // Get the job with document info
    const job = await db
      .select({
        id: ingestionJobs.id,
        status: ingestionJobs.status,
        stage: ingestionJobs.stage,
        errorCode: ingestionJobs.errorCode,
        attempts: ingestionJobs.attempts,
        maxAttempts: ingestionJobs.maxAttempts,
        lastError: ingestionJobs.lastError,
        startedAt: ingestionJobs.startedAt,
        completedAt: ingestionJobs.completedAt,
        metrics: ingestionJobs.metrics,
        createdAt: ingestionJobs.createdAt,
        updatedAt: ingestionJobs.updatedAt,
        documentVersionId: ingestionJobs.documentVersionId,
        businessId: ingestionJobs.businessId,
      })
      .from(ingestionJobs)
      .where(eq(ingestionJobs.id, jobId))
      .limit(1)
      .then(rows => rows[0])

    if (!job) {
      return NextResponse.json(
        { error: 'Job not found' },
        { status: 404 }
      )
    }

    // Verify job belongs to the requested business
    if (job.businessId !== businessId) {
      return NextResponse.json(
        { error: 'Job not found' },
        { status: 404 }
      )
    }

    // Get document info
    const version = await db
      .select({
        id: documentVersions.id,
        version: documentVersions.version,
        r2Key: documentVersions.r2Key,
        fileSize: documentVersions.fileSize,
        documentId: documentVersions.documentId,
      })
      .from(documentVersions)
      .where(eq(documentVersions.id, job.documentVersionId))
      .limit(1)
      .then(rows => rows[0])

    let documentInfo = null
    if (version) {
      const doc = await db
        .select({
          id: documents.id,
          title: documents.title,
          originalFilename: documents.originalFilename,
          status: documents.status,
        })
        .from(documents)
        .where(eq(documents.id, version.documentId))
        .limit(1)
        .then(rows => rows[0])

      documentInfo = {
        id: doc?.id,
        title: doc?.title,
        filename: doc?.originalFilename,
        status: doc?.status,
        version: version.version,
        fileSize: version.fileSize,
      }
    }

    // Calculate progress based on stage
    const stageProgress: Record<string, number> = {
      pending_upload: 0,
      uploaded: 10,
      downloading: 15,
      parsing: 30,
      chunking: 60,
      embedding: 80,
      cleanup: 95,
    }

    // Status-based progress overrides
    const statusProgress: Record<string, number> = {
      done: 100,
      failed: 0,
      retry_ready: 5,
    }

    const progress = statusProgress[job.status] ?? stageProgress[job.stage || ''] ?? 0

    return NextResponse.json({
      id: job.id,
      status: job.status,
      stage: job.stage,
      errorCode: job.errorCode,
      progress,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      lastError: job.lastError,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      metrics: job.metrics,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      document: documentInfo,
    })
  } catch (error) {
    console.error('[GET /api/documents/pdf/jobs/[id]] Error:', error)

    if (error instanceof Error) {
      if (error.message.includes('Unauthorized')) {
        return NextResponse.json({ error: error.message }, { status: 401 })
      }
      if (error.message.includes('Access denied')) {
        return NextResponse.json({ error: error.message }, { status: 403 })
      }
    }

    return NextResponse.json(
      { error: 'Failed to get job status' },
      { status: 500 }
    )
  }
}
