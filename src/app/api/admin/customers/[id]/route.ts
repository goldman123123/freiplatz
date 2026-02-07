/**
 * GET /api/admin/customers/[id] - Get customer details with recent activity
 * PATCH /api/admin/customers/[id] - Update customer
 * DELETE /api/admin/customers/[id] - Delete customer
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireBusinessAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import {
  customers,
  bookings,
  chatbotConversations,
  services,
  staff,
  documents,
} from '@/lib/db/schema'
import { eq, and, desc, count, sql } from 'drizzle-orm'
import { z } from 'zod'

// Validation schema for updating a customer
const updateCustomerSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  source: z.string().optional(),
  customFields: z.record(z.string(), z.any()).optional(),
})

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const authResult = await requireBusinessAuth()
  if (!authResult.success) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }

  const { id } = await params

  try {
    // Get customer
    const [customer] = await db
      .select()
      .from(customers)
      .where(
        and(
          eq(customers.id, id),
          eq(customers.businessId, authResult.business.id)
        )
      )
      .limit(1)

    if (!customer) {
      return NextResponse.json(
        { error: 'Kunde nicht gefunden' },
        { status: 404 }
      )
    }

    // Get recent bookings with service and staff info
    const recentBookings = await db
      .select({
        id: bookings.id,
        startsAt: bookings.startsAt,
        status: bookings.status,
        serviceName: services.name,
        staffName: staff.name,
      })
      .from(bookings)
      .leftJoin(services, eq(bookings.serviceId, services.id))
      .leftJoin(staff, eq(bookings.staffId, staff.id))
      .where(eq(bookings.customerId, id))
      .orderBy(desc(bookings.startsAt))
      .limit(5)

    // Get recent conversations
    const recentConversations = await db
      .select({
        id: chatbotConversations.id,
        channel: chatbotConversations.channel,
        status: chatbotConversations.status,
        createdAt: chatbotConversations.createdAt,
        updatedAt: chatbotConversations.updatedAt,
      })
      .from(chatbotConversations)
      .where(eq(chatbotConversations.customerId, id))
      .orderBy(desc(chatbotConversations.updatedAt))
      .limit(5)

    // Get stats
    const [bookingStats] = await db
      .select({ count: count() })
      .from(bookings)
      .where(eq(bookings.customerId, id))

    const [conversationStats] = await db
      .select({ count: count() })
      .from(chatbotConversations)
      .where(eq(chatbotConversations.customerId, id))

    const [documentStats] = await db
      .select({ count: count() })
      .from(documents)
      .where(
        and(
          eq(documents.businessId, authResult.business.id),
          eq(documents.scopeType, 'customer'),
          eq(documents.scopeId, id)
        )
      )

    return NextResponse.json({
      customer,
      recentBookings: recentBookings.map((b) => ({
        id: b.id,
        startsAt: b.startsAt?.toISOString(),
        status: b.status,
        serviceName: b.serviceName,
        staffName: b.staffName,
      })),
      recentConversations: recentConversations.map((c) => ({
        id: c.id,
        channel: c.channel,
        status: c.status,
        lastMessageAt: c.updatedAt?.toISOString(),
      })),
      stats: {
        totalBookings: bookingStats?.count || 0,
        totalConversations: conversationStats?.count || 0,
        totalDocuments: documentStats?.count || 0,
      },
    })
  } catch (error) {
    console.error('[GET /api/admin/customers/[id]] Error:', error)
    return NextResponse.json(
      { error: 'Fehler beim Laden des Kunden' },
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const authResult = await requireBusinessAuth()
  if (!authResult.success) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }

  const { id } = await params

  try {
    // Verify customer belongs to this business
    const [existing] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(
        and(
          eq(customers.id, id),
          eq(customers.businessId, authResult.business.id)
        )
      )
      .limit(1)

    if (!existing) {
      return NextResponse.json(
        { error: 'Kunde nicht gefunden' },
        { status: 404 }
      )
    }

    const body = await request.json()
    const parsed = updateCustomerSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const { name, email, phone, notes, source, customFields } = parsed.data

    // Check for email uniqueness if email is being updated
    if (email !== undefined && email !== null) {
      const emailConflict = await db
        .select({ id: customers.id })
        .from(customers)
        .where(
          and(
            eq(customers.businessId, authResult.business.id),
            eq(customers.email, email),
            sql`${customers.id} != ${id}`
          )
        )
        .limit(1)

      if (emailConflict.length > 0) {
        return NextResponse.json(
          { error: 'Ein anderer Kunde mit dieser E-Mail-Adresse existiert bereits' },
          { status: 409 }
        )
      }
    }

    // Build update object
    const updateData: Record<string, unknown> = {}
    if (name !== undefined) updateData.name = name
    if (email !== undefined) updateData.email = email
    if (phone !== undefined) updateData.phone = phone
    if (notes !== undefined) updateData.notes = notes
    if (source !== undefined) updateData.source = source
    if (customFields !== undefined) updateData.customFields = customFields

    const [updated] = await db
      .update(customers)
      .set(updateData)
      .where(eq(customers.id, id))
      .returning()

    return NextResponse.json({ customer: updated })
  } catch (error) {
    console.error('[PATCH /api/admin/customers/[id]] Error:', error)
    return NextResponse.json(
      { error: 'Fehler beim Aktualisieren des Kunden' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const authResult = await requireBusinessAuth()
  if (!authResult.success) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }

  const { id } = await params

  try {
    // Verify customer belongs to this business
    const [existing] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(
        and(
          eq(customers.id, id),
          eq(customers.businessId, authResult.business.id)
        )
      )
      .limit(1)

    if (!existing) {
      return NextResponse.json(
        { error: 'Kunde nicht gefunden' },
        { status: 404 }
      )
    }

    // Delete customer (cascades to related records via FK constraints)
    await db.delete(customers).where(eq(customers.id, id))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[DELETE /api/admin/customers/[id]] Error:', error)
    return NextResponse.json(
      { error: 'Fehler beim Löschen des Kunden' },
      { status: 500 }
    )
  }
}
