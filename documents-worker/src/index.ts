/**
 * Hebelki Documents Worker
 *
 * Continuously polls for PDF processing jobs and processes them.
 * Uses FOR UPDATE SKIP LOCKED for safe concurrent processing.
 */

import { claimJobs, type IngestionJob } from './db.js'
import { processJob } from './job-processor.js'

const POLL_INTERVAL_MS = 3000 // 3 seconds when no work
const WORKER_CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || '2', 10)
const JOB_BATCH_SIZE = parseInt(process.env.JOB_BATCH_SIZE || '5', 10)

console.log('='.repeat(60))
console.log('Hebelki Documents Worker')
console.log('='.repeat(60))
console.log(`Configuration:`)
console.log(`  WORKER_CONCURRENCY: ${WORKER_CONCURRENCY}`)
console.log(`  JOB_BATCH_SIZE: ${JOB_BATCH_SIZE}`)
console.log(`  POLL_INTERVAL_MS: ${POLL_INTERVAL_MS}`)
console.log('='.repeat(60))

// Graceful shutdown
let isShuttingDown = false

process.on('SIGTERM', () => {
  console.log('\n[Worker] Received SIGTERM, shutting down gracefully...')
  isShuttingDown = true
})

process.on('SIGINT', () => {
  console.log('\n[Worker] Received SIGINT, shutting down gracefully...')
  isShuttingDown = true
})

/**
 * Main worker loop
 */
async function main() {
  console.log('[Worker] Starting main loop...')

  let totalProcessed = 0
  let totalFailed = 0

  while (!isShuttingDown) {
    try {
      // Claim jobs from the queue
      const jobs = await claimJobs(JOB_BATCH_SIZE)

      if (jobs.length === 0) {
        // No work, sleep and try again
        await sleep(POLL_INTERVAL_MS)
        continue
      }

      console.log(`\n[Worker] Claimed ${jobs.length} jobs`)

      // Process jobs with bounded concurrency
      const results = await processJobsWithConcurrency(jobs, WORKER_CONCURRENCY)

      // Update stats
      const succeeded = results.filter(r => r.success).length
      const failed = results.filter(r => !r.success).length
      totalProcessed += succeeded
      totalFailed += failed

      console.log(`[Worker] Batch complete: ${succeeded} succeeded, ${failed} failed`)
      console.log(`[Worker] Total: ${totalProcessed} processed, ${totalFailed} failed`)

      // Small delay between batches to prevent tight loops
      await sleep(100)
    } catch (error) {
      console.error('[Worker] Error in main loop:', error)
      // Wait before retrying to prevent tight error loops
      await sleep(5000)
    }
  }

  console.log('[Worker] Shutdown complete')
  process.exit(0)
}

/**
 * Process jobs with bounded concurrency
 */
async function processJobsWithConcurrency(
  jobs: IngestionJob[],
  concurrency: number
): Promise<Array<{ success: boolean }>> {
  const results: Array<{ success: boolean }> = []
  const executing: Promise<void>[] = []

  for (const job of jobs) {
    const promise = processJob(job)
      .then(result => {
        results.push({ success: result.success })
      })
      .catch(error => {
        console.error(`[Worker] Unexpected error processing job ${job.id}:`, error)
        results.push({ success: false })
      })

    executing.push(promise)

    // If we've hit concurrency limit, wait for one to finish
    if (executing.length >= concurrency) {
      await Promise.race(executing)
      // Remove completed promises
      for (let i = executing.length - 1; i >= 0; i--) {
        if (await Promise.race([executing[i], Promise.resolve('pending')]) !== 'pending') {
          executing.splice(i, 1)
        }
      }
    }
  }

  // Wait for remaining jobs to complete
  await Promise.all(executing)

  return results
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Start the worker
main().catch(error => {
  console.error('[Worker] Fatal error:', error)
  process.exit(1)
})
