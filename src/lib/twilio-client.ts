/**
 * Per-Tenant Twilio WhatsApp Client
 *
 * BYOT (Bring Your Own Twilio): Each business stores encrypted credentials
 * in their settings JSONB. Falls back to global env vars for sandbox testing.
 *
 * 5-minute in-memory cache per businessId to avoid repeated DB lookups + decryption.
 */

import twilio from 'twilio'
import { db } from '@/lib/db'
import { businesses } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { decrypt } from '@/lib/crypto'

// --- Types ---

export interface SendWhatsAppMessageParams {
  to: string      // E.164 format with whatsapp: prefix (e.g., "whatsapp:+5926964488")
  body: string    // Message text
  from?: string   // Optional - defaults to business's configured number
}

export interface SendWhatsAppMessageResult {
  success: boolean
  sid?: string
  error?: string
  errorCode?: string
}

interface TwilioCredentials {
  accountSid: string
  authToken: string
  whatsappNumber: string
}

// --- Credential Cache (5 minutes) ---

const CACHE_TTL_MS = 5 * 60 * 1000
const credentialCache = new Map<string, { creds: TwilioCredentials; expiresAt: number }>()

/**
 * Load Twilio credentials for a business.
 * Checks settings JSONB first, falls back to env vars.
 */
export async function getTwilioCredentials(businessId: string): Promise<TwilioCredentials> {
  // Check cache
  const cached = credentialCache.get(businessId)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.creds
  }

  // Load from DB
  const business = await db
    .select({ settings: businesses.settings })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1)
    .then(rows => rows[0])

  const settings = (business?.settings as Record<string, unknown>) || {}

  let creds: TwilioCredentials

  if (settings.twilioAccountSid && settings.twilioAuthTokenEncrypted) {
    // Per-tenant BYOT credentials
    creds = {
      accountSid: settings.twilioAccountSid as string,
      authToken: decrypt(settings.twilioAuthTokenEncrypted as string),
      whatsappNumber: settings.twilioWhatsappNumber
        ? `whatsapp:${settings.twilioWhatsappNumber}`
        : process.env.TWILIO_WHATSAPP_NUMBER || '',
    }
  } else {
    // Fallback to global env vars (sandbox)
    creds = {
      accountSid: process.env.TWILIO_ACCOUNT_SID || '',
      authToken: process.env.TWILIO_AUTH_TOKEN || '',
      whatsappNumber: process.env.TWILIO_WHATSAPP_NUMBER || '',
    }
  }

  // Cache for 5 minutes
  credentialCache.set(businessId, {
    creds,
    expiresAt: Date.now() + CACHE_TTL_MS,
  })

  return creds
}

/**
 * Invalidate cached credentials for a business (call after credential update).
 */
export function invalidateCredentialCache(businessId: string) {
  credentialCache.delete(businessId)
}

/**
 * Send a WhatsApp message using the business's Twilio credentials.
 */
export async function sendWhatsAppMessage(
  params: SendWhatsAppMessageParams,
  businessId?: string
): Promise<SendWhatsAppMessageResult> {
  try {
    const { to, body, from } = params

    // Get credentials — per-tenant if businessId provided, else global
    let accountSid: string
    let authToken: string
    let fromNumber: string

    if (businessId) {
      const creds = await getTwilioCredentials(businessId)
      accountSid = creds.accountSid
      authToken = creds.authToken
      fromNumber = from || creds.whatsappNumber
    } else {
      accountSid = process.env.TWILIO_ACCOUNT_SID || ''
      authToken = process.env.TWILIO_AUTH_TOKEN || ''
      fromNumber = from || process.env.TWILIO_WHATSAPP_NUMBER || ''
    }

    const client = twilio(accountSid, authToken)

    // Ensure 'to' has whatsapp: prefix
    const toNumber = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`

    const message = await client.messages.create({
      from: fromNumber,
      to: toNumber,
      body,
    })

    console.log('[Twilio] WhatsApp message sent:', {
      sid: message.sid,
      to: toNumber,
      status: message.status,
      business: businessId || 'global',
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
 * Verify Twilio webhook signature.
 * Uses the business's auth token if businessId provided.
 */
export function validateTwilioWebhook(
  authToken: string,
  twilioSignature: string,
  url: string,
  params: Record<string, any>
): boolean {
  return twilio.validateRequest(authToken, twilioSignature, url, params)
}
