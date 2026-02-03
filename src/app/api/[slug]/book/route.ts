import { NextRequest, NextResponse } from 'next/server'
import {
  getBusinessBySlug,
  getServiceById,
  getStaffById,
  getOrCreateCustomer,
  createBooking,
} from '@/lib/db/queries'
import { isSlotAvailable } from '@/lib/availability'
import { sendEmail } from '@/lib/email'
import { bookingConfirmationEmail, bookingNotificationEmail } from '@/lib/email-templates'

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
    const service = await getServiceById(serviceId)
    if (!service || service.businessId !== business.id) {
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
      const staffMember = await getStaffById(staffId)
      staffName = staffMember?.name
    }

    // Create booking
    const booking = await createBooking({
      businessId: business.id,
      serviceId,
      staffId,
      customerId: customer.id,
      startsAt: slotStart,
      endsAt,
      price: service.price || undefined,
      notes,
      source: 'web',
    })

    // Send confirmation email to customer
    const emailData = {
      customerName,
      customerEmail,
      serviceName: service.name,
      staffName,
      businessName: business.name,
      startsAt: slotStart,
      endsAt,
      confirmationToken: booking.confirmationToken || booking.id,
      notes,
      price: service.price ? parseFloat(service.price) : undefined,
      currency: business.currency || 'EUR',
    }

    try {
      const confirmationEmail = bookingConfirmationEmail(emailData)
      await sendEmail({
        to: customerEmail,
        subject: confirmationEmail.subject,
        html: confirmationEmail.html,
        text: confirmationEmail.text,
      })

      // Send notification email to business
      if (business.email) {
        const notificationEmail = bookingNotificationEmail({
          ...emailData,
          customerPhone,
        })
        await sendEmail({
          to: business.email,
          subject: notificationEmail.subject,
          html: notificationEmail.html,
          text: notificationEmail.text,
        })
      }
    } catch (emailError) {
      console.error('Error sending booking emails:', emailError)
      // Don't fail the booking if email fails
    }

    return NextResponse.json({
      id: booking.id,
      confirmationToken: booking.confirmationToken,
      status: booking.status,
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
    })
  } catch (error) {
    console.error('Error creating booking:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
