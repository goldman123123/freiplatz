import { NextRequest, NextResponse } from 'next/server'
import { getBusinessBySlug, getServiceById } from '@/lib/db/queries'
import { getAvailableSlots, getAvailableDates } from '@/lib/availability'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params
    const { searchParams } = new URL(request.url)
    const serviceId = searchParams.get('serviceId')
    const staffId = searchParams.get('staffId') || undefined
    const date = searchParams.get('date')
    const month = searchParams.get('month')

    if (!serviceId) {
      return NextResponse.json(
        { error: 'serviceId is required' },
        { status: 400 }
      )
    }

    const business = await getBusinessBySlug(slug)
    if (!business) {
      return NextResponse.json(
        { error: 'Business not found' },
        { status: 404 }
      )
    }

    const service = await getServiceById(serviceId, business.id)
    if (!service) {
      return NextResponse.json(
        { error: 'Service not found' },
        { status: 404 }
      )
    }

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

    // If date is provided, return time slots for that date
    if (date) {
      const slots = await getAvailableSlots(config, new Date(date))
      return NextResponse.json({
        slots: slots.map((s) => ({
          start: s.start.toISOString(),
          end: s.end.toISOString(),
          available: s.available,
        })),
      })
    }

    // If month is provided, return available dates for that month
    if (month) {
      const dates = await getAvailableDates(config, new Date(month))
      return NextResponse.json({
        dates: dates.map((d) => d.toISOString().split('T')[0]),
      })
    }

    // Default: return available dates for current month
    const dates = await getAvailableDates(config, new Date())
    return NextResponse.json({
      dates: dates.map((d) => d.toISOString().split('T')[0]),
    })
  } catch (error) {
    console.error('Error fetching availability:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
