import { NextRequest, NextResponse } from 'next/server'
import {
  getBusinessBySlug,
  getServiceById,
  getStaffById,
  getOrCreateCustomer,
} from '@/lib/db/queries'
import { isSlotAvailable } from '@/lib/availability'
import { db } from '@/lib/db'
import { bookings } from '@/lib/db/schema'
import { emitEvent } from '@/modules/core/events'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params
    const body = await request.json()

    const {
      serviceId,
      staffId,
      startsAt,
      customerName,
      customerEmail,
      customerPhone,
      notes,
    } = body

    // Validate required fields
    if (!serviceId || !startsAt || !customerName || !customerEmail) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Get business
    const business = await getBusinessBySlug(slug)
    if (!business) {
      return NextResponse.json(
        { error: 'Business not found' },
        { status: 404 }
      )
    }

    // Get service
    const service = await getServiceById(serviceId, business.id)
    if (!service) {
      return NextResponse.json(
        { error: 'Service not found' },
        { status: 404 }
      )
    }

    // Verify slot is still available
    const config = {
      businessId: business.id,
      serviceId,
      staffId,
      durationMinutes: service.durationMinutes,
      bufferMinutes: service.bufferMinutes || 0,
      minBookingNoticeHours: business.minBookingNoticeHours || 24,
      maxAdvanceBookingDays: business.maxAdvanceBookingDays || 60,
      timezone: business.timezone || 'Europe/Berlin',
    }

    const slotStart = new Date(startsAt)
    const available = await isSlotAvailable(config, slotStart)

    if (!available) {
      return NextResponse.json(
        { error: 'This time slot is no longer available. Please select another time.' },
        { status: 409 }
      )
    }

    // Get or create customer
    const customer = await getOrCreateCustomer(
      business.id,
      customerEmail,
      customerName,
      customerPhone
    )

    // Calculate end time
    const endsAt = new Date(slotStart.getTime() + service.durationMinutes * 60 * 1000)

    // Get staff name if assigned
    let staffName: string | undefined
    if (staffId) {
      const staffMember = await getStaffById(staffId, business.id)
      staffName = staffMember?.name
    }

    // Create booking within transaction and emit event
    const booking = await db.transaction(async (tx) => {
      // Create booking
      const inserted = await tx
        .insert(bookings)
        .values({
          businessId: business.id,
          serviceId,
          staffId,
          customerId: customer.id,
          startsAt: slotStart,
          endsAt,
          price: service.price || undefined,
          notes,
          source: 'web',
          status: 'pending',
        })
        .returning()

      const booking = inserted[0]

      // Emit booking.created event (async email processing)
      await emitEvent(tx, business.id, 'booking.created', {
        bookingId: booking.id,
        customerEmail,
        customerName,
        customerPhone,
        serviceName: service.name,
        businessName: business.name,
        businessEmail: business.email || undefined,
        staffName,
        startsAt: slotStart.toISOString(),
        endsAt: endsAt.toISOString(),
        price: service.price ? parseFloat(service.price) : undefined,
        currency: business.currency || 'EUR',
        confirmationToken: booking.confirmationToken || booking.id,
        notes,
      })

      return booking
    })

    return NextResponse.json({
      id: booking.id,
      confirmationToken: booking.confirmationToken,
      status: booking.status,
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
    })
  } catch (error) {
    console.error('Error creating booking:', error)

    // Handle double-booking constraint violation
    if (error && typeof error === 'object' && 'constraint' in error) {
      if ((error as { constraint?: string }).constraint === 'no_overlapping_bookings') {
        return NextResponse.json(
          { error: 'Dieser Zeitslot ist nicht mehr verfügbar. Bitte wählen Sie eine andere Zeit.' },
          { status: 409 }
        )
      }
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
