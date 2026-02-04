import { NextRequest, NextResponse } from 'next/server'
import { requireBusinessAuth } from '@/lib/auth'
import { getBookingById, updateBookingStatus, verifyBookingOwnership } from '@/lib/db/queries'
import { bookingStatusSchema } from '@/lib/validations/schemas'
import { db } from '@/lib/db'
import { emitEventStandalone } from '@/modules/core/events'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireBusinessAuth()
  if (!authResult.success) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }

  const { id } = await params

  // Verify ownership
  const isOwner = await verifyBookingOwnership(id, authResult.business.id)
  if (!isOwner) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  const booking = await getBookingById(id)

  if (!booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  return NextResponse.json({ booking })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireBusinessAuth()
  if (!authResult.success) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }

  const { id } = await params

  // Verify ownership
  const isOwner = await verifyBookingOwnership(id, authResult.business.id)
  if (!isOwner) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  // Get current booking details before update (for email data)
  const currentBooking = await getBookingById(id)
  if (!currentBooking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  const body = await request.json()

  const parsed = bookingStatusSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { status, cancellationReason, cancelledBy, internalNotes } = parsed.data
  const previousStatus = currentBooking.booking.status

  const booking = await updateBookingStatus(id, authResult.business.id, status, {
    cancellationReason: cancellationReason || undefined,
    cancelledBy: cancelledBy || undefined,
    internalNotes: internalNotes || undefined,
  })

  if (!booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  // Emit events for status changes (async email processing)
  if (status !== previousStatus && currentBooking.customer?.email) {
    try {
      if (status === 'confirmed' && previousStatus !== 'confirmed') {
        // Emit booking.confirmed event
        await emitEventStandalone(authResult.business.id, 'booking.confirmed', {
          bookingId: id,
          customerEmail: currentBooking.customer.email,
          customerName: currentBooking.customer.name || 'Kunde',
          serviceName: currentBooking.service?.name || 'Service',
          staffName: currentBooking.staffMember?.name,
          businessName: authResult.business.name,
          startsAt: currentBooking.booking.startsAt.toISOString(),
          endsAt: currentBooking.booking.endsAt.toISOString(),
          price: currentBooking.service?.price ? parseFloat(currentBooking.service.price) : undefined,
          currency: authResult.business.currency || 'EUR',
          confirmationToken: currentBooking.booking.confirmationToken || currentBooking.booking.id,
        })
      } else if (status === 'cancelled' && previousStatus !== 'cancelled') {
        // Emit booking.cancelled event
        await emitEventStandalone(authResult.business.id, 'booking.cancelled', {
          bookingId: id,
          customerEmail: currentBooking.customer.email,
          customerName: currentBooking.customer.name || 'Kunde',
          serviceName: currentBooking.service?.name || 'Service',
          staffName: currentBooking.staffMember?.name,
          businessName: authResult.business.name,
          startsAt: currentBooking.booking.startsAt.toISOString(),
          endsAt: currentBooking.booking.endsAt.toISOString(),
          reason: cancellationReason || undefined,
          cancelledBy: cancelledBy || 'staff',
        })
      }
    } catch (eventError) {
      console.error('Error emitting status change event:', eventError)
      // Don't fail the status update if event emission fails
    }
  }

  return NextResponse.json({ booking })
}
