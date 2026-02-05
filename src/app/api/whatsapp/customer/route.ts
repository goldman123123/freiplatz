/**
 * WhatsApp Customer Lookup/Create API
 *
 * GET  /api/whatsapp/customer?phone=+123&business=slug
 * POST /api/whatsapp/customer (body: { phone, businessId, name })
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { customers, businesses } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { formatE164Phone } from '@/lib/whatsapp-phone-formatter'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const phone = searchParams.get('phone')
    const businessSlug = searchParams.get('business')

    if (!phone || !businessSlug) {
      return NextResponse.json(
        { error: 'phone and business required' },
        { status: 400 }
      )
    }

    // Normalize phone to E.164 format
    const normalizedPhone = formatE164Phone(phone)

    // Find business
    const business = await db
      .select({ id: businesses.id })
      .from(businesses)
      .where(eq(businesses.slug, businessSlug))
      .limit(1)
      .then(rows => rows[0])

    if (!business) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 })
    }

    // Find customer by phone + business
    const customer = await db
      .select({
        id: customers.id,
        name: customers.name,
        email: customers.email,
        whatsappOptInStatus: customers.whatsappOptInStatus,
      })
      .from(customers)
      .where(
        and(
          eq(customers.businessId, business.id),
          eq(customers.phone, normalizedPhone)
        )
      )
      .limit(1)
      .then(rows => rows[0])

    if (!customer) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }

    return NextResponse.json({
      customerId: customer.id,
      businessId: business.id,
      customer,
    })
  } catch (error) {
    console.error('[WhatsApp Customer Lookup] Error:', error)
    return NextResponse.json(
      { error: 'Internal error' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { phone, businessId, name } = body

    if (!phone || !businessId) {
      return NextResponse.json(
        { error: 'phone and businessId required' },
        { status: 400 }
      )
    }

    // Normalize phone
    const normalizedPhone = formatE164Phone(phone)

    // Check if customer already exists
    const existingCustomer = await db
      .select()
      .from(customers)
      .where(
        and(
          eq(customers.businessId, businessId),
          eq(customers.phone, normalizedPhone)
        )
      )
      .limit(1)
      .then(rows => rows[0])

    if (existingCustomer) {
      return NextResponse.json({
        customerId: existingCustomer.id,
        businessId,
        customer: existingCustomer,
        created: false,
      })
    }

    // Create customer with WhatsApp channel
    const [newCustomer] = await db
      .insert(customers)
      .values({
        businessId,
        phone: normalizedPhone,
        name: name || 'WhatsApp Customer',
        source: 'whatsapp',
        whatsappOptInStatus: 'UNSET', // Will be set on first message
      })
      .returning()

    return NextResponse.json({
      customerId: newCustomer.id,
      businessId,
      customer: newCustomer,
      created: true,
    })
  } catch (error) {
    console.error('[WhatsApp Customer Create] Error:', error)
    return NextResponse.json(
      { error: 'Internal error' },
      { status: 500 }
    )
  }
}
