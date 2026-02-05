/**
 * WhatsApp Send API
 *
 * POST /api/whatsapp/send
 *
 * Sends a WhatsApp message via Twilio
 * Used by n8n workflows and internal processes
 */

import { NextRequest, NextResponse } from 'next/server'
import { sendWhatsAppMessage } from '@/lib/twilio-client'
import { formatTwilioWhatsAppNumber } from '@/lib/whatsapp-phone-formatter'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { to, body: messageBody, from } = body

    if (!to || !messageBody) {
      return NextResponse.json(
        { error: 'to and body are required' },
        { status: 400 }
      )
    }

    // Format phone number with whatsapp: prefix
    const formattedTo = formatTwilioWhatsAppNumber(to)

    // Send message
    const result = await sendWhatsAppMessage({
      to: formattedTo,
      body: messageBody,
      from,
    })

    if (!result.success) {
      return NextResponse.json(
        { error: result.error, code: result.errorCode },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      sid: result.sid,
      to: formattedTo,
    })
  } catch (error) {
    console.error('[WhatsApp Send API] Error:', error)
    return NextResponse.json(
      { error: 'Internal error' },
      { status: 500 }
    )
  }
}
