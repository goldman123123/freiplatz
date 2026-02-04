/**
 * Clerk Webhook Endpoint
 *
 * Handles user lifecycle events from Clerk:
 * - user.deleted: Remove user from all business memberships
 * - user.updated: Update user information (future)
 *
 * Security: Verifies webhook signature using Svix
 */

import { NextRequest, NextResponse } from 'next/server'
import { Webhook } from 'svix'
import { headers } from 'next/headers'
import { db } from '@/lib/db'
import { businessMembers } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export async function POST(req: NextRequest) {
  const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET

  if (!WEBHOOK_SECRET) {
    console.error('[Clerk Webhook] CLERK_WEBHOOK_SECRET not configured')
    return new Response('Webhook not configured', { status: 500 })
  }

  // Get the headers
  const headerPayload = headers()
  const svix_id = headerPayload.get('svix-id')
  const svix_timestamp = headerPayload.get('svix-timestamp')
  const svix_signature = headerPayload.get('svix-signature')

  // If there are no headers, error out
  if (!svix_id || !svix_timestamp || !svix_signature) {
    console.error('[Clerk Webhook] Missing svix headers')
    return new Response('Missing headers', { status: 400 })
  }

  // Get the body
  const payload = await req.json()
  const body = JSON.stringify(payload)

  // Create a new Svix instance with your secret
  const wh = new Webhook(WEBHOOK_SECRET)

  let evt: any

  // Verify the payload with the headers
  try {
    evt = wh.verify(body, {
      'svix-id': svix_id,
      'svix-timestamp': svix_timestamp,
      'svix-signature': svix_signature,
    })
  } catch (err) {
    console.error('[Clerk Webhook] Error verifying webhook:', err)
    return new Response('Invalid signature', { status: 400 })
  }

  // Get the event type
  const eventType = evt.type

  console.log(`[Clerk Webhook] Received event: ${eventType}`)

  // Handle user.deleted event
  if (eventType === 'user.deleted') {
    const userId = evt.data.id

    console.log(`[Clerk Webhook] Deleting user ${userId} from all business memberships`)

    try {
      // Remove user from all business memberships
      const result = await db
        .delete(businessMembers)
        .where(eq(businessMembers.clerkUserId, userId))

      console.log(`[Clerk Webhook] Removed user ${userId} from ${result.rowCount || 0} business(es)`)
    } catch (error) {
      console.error('[Clerk Webhook] Error deleting user memberships:', error)
      return new Response('Error processing webhook', { status: 500 })
    }
  }

  // Handle user.updated event (future: update email for invitations)
  if (eventType === 'user.updated') {
    const userId = evt.data.id
    const userEmail = evt.data.email_addresses?.[0]?.email_address

    console.log(`[Clerk Webhook] User ${userId} updated, email: ${userEmail}`)

    // Future: Update pending invitations if email changed
    // This would be useful for matching invited users by email
  }

  return new Response('', { status: 200 })
}
