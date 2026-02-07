/**
 * GET /api/admin/customers - List customers with search and pagination
 * POST /api/admin/customers - Create a new customer
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireBusinessAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { customers, bookings, chatbotConversations } from '@/lib/db/schema'
import { eq, and, or, ilike, desc, sql, count } from 'drizzle-orm'
import { z } from 'zod'

// Validation schema for creating a customer
const createCustomerSchema = z.object({
  name: z.string().min(1, 'Name ist erforderlich'),
  email: z.string().email('Ungültige E-Mail-Adresse').optional().nullable(),
  phone: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  source: z.string().optional().default('manual'),
  customFields: z.record(z.string(), z.any()).optional().default({}),
})

export async function GET(request: NextRequest) {
  const authResult = await requireBusinessAuth()
  if (!authResult.success) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }

  const searchParams = request.nextUrl.searchParams
  const search = searchParams.get('search') || ''
  const sortBy = searchParams.get('sortBy') || 'name'
  const limit = parseInt(searchParams.get('limit') || '50', 10)
  const offset = parseInt(searchParams.get('offset') || '0', 10)

  try {
    // Build search filter
    const searchFilter = search.trim()
      ? or(
          ilike(customers.name, `%${search}%`),
          ilike(customers.email, `%${search}%`),
          ilike(customers.phone, `%${search}%`)
        )
      : undefined

    // Get customers with booking and conversation counts
    const customersQuery = db
      .select({
        id: customers.id,
        name: customers.name,
        email: customers.email,
        phone: customers.phone,
        notes: customers.notes,
        source: customers.source,
        customFields: customers.customFields,
        createdAt: customers.createdAt,
      })
      .from(customers)
      .where(
        searchFilter
          ? and(eq(customers.businessId, authResult.business.id), searchFilter)
          : eq(customers.businessId, authResult.business.id)
      )
      .orderBy(sortBy === 'name' ? customers.name : desc(customers.createdAt))
      .limit(limit)
      .offset(offset)

    const customersData = await customersQuery

    // Get total count for pagination
    const totalResult = await db
      .select({ count: count() })
      .from(customers)
      .where(
        searchFilter
          ? and(eq(customers.businessId, authResult.business.id), searchFilter)
          : eq(customers.businessId, authResult.business.id)
      )

    const total = totalResult[0]?.count || 0

    // Get booking and conversation counts for each customer
    const customersWithStats = await Promise.all(
      customersData.map(async (customer) => {
        // Get booking count
        const bookingResult = await db
          .select({ count: count() })
          .from(bookings)
          .where(eq(bookings.customerId, customer.id))

        // Get conversation count
        const conversationResult = await db
          .select({ count: count() })
          .from(chatbotConversations)
          .where(eq(chatbotConversations.customerId, customer.id))

        // Get last activity (most recent booking or conversation)
        const lastBooking = await db
          .select({ startsAt: bookings.startsAt })
          .from(bookings)
          .where(eq(bookings.customerId, customer.id))
          .orderBy(desc(bookings.startsAt))
          .limit(1)

        const lastConversation = await db
          .select({ createdAt: chatbotConversations.createdAt })
          .from(chatbotConversations)
          .where(eq(chatbotConversations.customerId, customer.id))
          .orderBy(desc(chatbotConversations.createdAt))
          .limit(1)

        // Determine last activity
        const bookingDate = lastBooking[0]?.startsAt
        const conversationDate = lastConversation[0]?.createdAt
        let lastActivity: string | null = null

        if (bookingDate && conversationDate) {
          lastActivity = new Date(bookingDate) > new Date(conversationDate)
            ? bookingDate.toISOString()
            : conversationDate.toISOString()
        } else if (bookingDate) {
          lastActivity = bookingDate.toISOString()
        } else if (conversationDate) {
          lastActivity = conversationDate.toISOString()
        }

        // Extract tags from customFields
        const customFieldsObj = customer.customFields as Record<string, unknown> || {}
        const tags = Array.isArray(customFieldsObj.tags) ? customFieldsObj.tags : []

        return {
          id: customer.id,
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
          tags,
          lastActivity,
          bookingCount: bookingResult[0]?.count || 0,
          conversationCount: conversationResult[0]?.count || 0,
          createdAt: customer.createdAt,
        }
      })
    )

    return NextResponse.json({
      customers: customersWithStats,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + customersData.length < total,
      },
    })
  } catch (error) {
    console.error('[GET /api/admin/customers] Error:', error)
    return NextResponse.json(
      { error: 'Fehler beim Laden der Kunden' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const authResult = await requireBusinessAuth()
  if (!authResult.success) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }

  try {
    const body = await request.json()
    const parsed = createCustomerSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const { name, email, phone, notes, source, customFields } = parsed.data

    // Check for existing customer with same email if email provided
    if (email) {
      const existing = await db
        .select({ id: customers.id })
        .from(customers)
        .where(
          and(
            eq(customers.businessId, authResult.business.id),
            eq(customers.email, email)
          )
        )
        .limit(1)

      if (existing.length > 0) {
        return NextResponse.json(
          { error: 'Ein Kunde mit dieser E-Mail-Adresse existiert bereits' },
          { status: 409 }
        )
      }
    }

    const [newCustomer] = await db
      .insert(customers)
      .values({
        businessId: authResult.business.id,
        name,
        email: email || null,
        phone: phone || null,
        notes: notes || null,
        source,
        customFields,
      })
      .returning()

    return NextResponse.json({ customer: newCustomer }, { status: 201 })
  } catch (error) {
    console.error('[POST /api/admin/customers] Error:', error)
    return NextResponse.json(
      { error: 'Fehler beim Erstellen des Kunden' },
      { status: 500 }
    )
  }
}
