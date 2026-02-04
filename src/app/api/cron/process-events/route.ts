/**
 * Event Processing Cron Endpoint
 *
 * This endpoint is called by Vercel Cron every minute to process pending events
 * from the event outbox. It handles async email sending and other side effects.
 *
 * Security: Requires a CRON_SECRET token in the Authorization header.
 */

import { NextRequest, NextResponse } from 'next/server'
import { processEvents } from '@/modules/core/events/processor'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60 // 60 seconds (Vercel hobby/pro limits)

export async function GET(request: NextRequest) {
  console.log('[Cron] Event processing cron job triggered')

  // Verify cron secret
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret) {
    console.error('[Cron] CRON_SECRET not configured')
    return NextResponse.json(
      { error: 'Cron not configured' },
      { status: 500 }
    )
  }

  // Check authorization header format: "Bearer <secret>"
  const expectedAuth = `Bearer ${cronSecret}`
  if (authHeader !== expectedAuth) {
    console.error('[Cron] Invalid or missing authorization header')
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    )
  }

  try {
    const startTime = Date.now()

    // Process up to 100 events
    const processed = await processEvents(100)

    const duration = Date.now() - startTime

    console.log(`[Cron] Event processing completed: ${processed} events processed in ${duration}ms`)

    return NextResponse.json({
      success: true,
      processed,
      duration,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[Cron] Event processing failed:', error)

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    )
  }
}
