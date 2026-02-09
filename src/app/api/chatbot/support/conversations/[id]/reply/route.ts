/**
 * Support Reply API
 *
 * POST /api/chatbot/support/conversations/[id]/reply
 *
 * Staff sends a reply to a customer conversation.
 * Sets status to live_active if was live_queue.
 * Auth-protected: requires business membership.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth, clerkClient } from '@clerk/nextjs/server'
import { requireBusinessAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { chatbotConversations, chatbotMessages, customers } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { sendWhatsAppMessage } from '@/lib/twilio-client'
import { formatTwilioWhatsAppNumber } from '@/lib/whatsapp-phone-formatter'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireBusinessAuth()
    if (!authResult.success) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const { id: conversationId } = await params
    const body = await request.json()
    const { message } = body

    if (!message || typeof message !== 'string' || !message.trim()) {
      return NextResponse.json({ error: 'Nachricht ist erforderlich' }, { status: 400 })
    }

    // Verify conversation belongs to business
    const conversation = await db
      .select()
      .from(chatbotConversations)
      .where(and(
        eq(chatbotConversations.id, conversationId),
        eq(chatbotConversations.businessId, authResult.business.id)
      ))
      .limit(1)
      .then(rows => rows[0])

    if (!conversation) {
      return NextResponse.json({ error: 'Gespräch nicht gefunden' }, { status: 404 })
    }

    // Get staff name from Clerk user
    const { userId } = await auth()
    let staffName = 'Support'

    if (userId) {
      try {
        const clerk = await clerkClient()
        const user = await clerk.users.getUser(userId)
        staffName = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Support'
      } catch {
        // Fall back to 'Support' if Clerk lookup fails
      }
    }

    // Insert staff message
    const [newMessage] = await db
      .insert(chatbotMessages)
      .values({
        conversationId,
        role: 'staff',
        content: message.trim(),
        metadata: {
          staffName,
          staffClerkUserId: userId,
        },
      })
      .returning()

    // Update conversation status
    const updates: Record<string, unknown> = { updatedAt: new Date() }

    if (conversation.status === 'live_queue' || conversation.status === 'escalated') {
      updates.status = 'live_active'
    }

    await db
      .update(chatbotConversations)
      .set(updates)
      .where(eq(chatbotConversations.id, conversationId))

    // Relay to WhatsApp if this is a WhatsApp conversation
    if (conversation.channel === 'whatsapp' && conversation.customerId) {
      try {
        const customer = await db
          .select({ phone: customers.phone })
          .from(customers)
          .where(eq(customers.id, conversation.customerId))
          .limit(1)
          .then(rows => rows[0])

        if (customer?.phone) {
          await sendWhatsAppMessage(
            {
              to: formatTwilioWhatsAppNumber(customer.phone),
              body: message.trim(),
            },
            authResult.business.id
          )
        }
      } catch (whatsappError) {
        // Log but don't fail the HTTP response — message is saved in DB regardless
        console.error('[Support Reply] WhatsApp relay failed:', whatsappError)
      }
    }

    return NextResponse.json({
      success: true,
      message: {
        id: newMessage.id,
        role: newMessage.role,
        content: newMessage.content,
        metadata: newMessage.metadata,
        createdAt: newMessage.createdAt?.toISOString(),
      },
    })
  } catch (error) {
    console.error('[Support Reply API] Error:', error)
    return NextResponse.json(
      { error: 'Fehler beim Senden der Antwort' },
      { status: 500 }
    )
  }
}
