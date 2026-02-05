/**
 * Twilio WhatsApp Client
 *
 * Handles sending WhatsApp messages via Twilio API
 */

import twilio from 'twilio'

// Initialize Twilio client
const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
)

export interface SendWhatsAppMessageParams {
  to: string      // E.164 format with whatsapp: prefix (e.g., "whatsapp:+5926964488")
  body: string    // Message text
  from?: string   // Optional - defaults to env var
}

export interface SendWhatsAppMessageResult {
  success: boolean
  sid?: string
  error?: string
  errorCode?: string
}

/**
 * Send a WhatsApp message via Twilio
 */
export async function sendWhatsAppMessage(
  params: SendWhatsAppMessageParams
): Promise<SendWhatsAppMessageResult> {
  try {
    const { to, body, from } = params

    // Ensure 'to' has whatsapp: prefix
    const toNumber = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`

    const message = await client.messages.create({
      from: from || process.env.TWILIO_WHATSAPP_NUMBER,
      to: toNumber,
      body,
    })

    console.log('[Twilio] WhatsApp message sent:', {
      sid: message.sid,
      to: toNumber,
      status: message.status,
    })

    return {
      success: true,
      sid: message.sid,
    }
  } catch (error: any) {
    console.error('[Twilio] Error sending WhatsApp message:', {
      error: error.message,
      code: error.code,
      moreInfo: error.moreInfo,
    })

    return {
      success: false,
      error: error.message,
      errorCode: error.code,
    }
  }
}

/**
 * Verify Twilio webhook signature (for security)
 */
export function validateTwilioWebhook(
  authToken: string,
  twilioSignature: string,
  url: string,
  params: Record<string, any>
): boolean {
  return twilio.validateRequest(authToken, twilioSignature, url, params)
}
