import { NextRequest, NextResponse } from 'next/server'
import { requireBusinessAuth } from '@/lib/auth'
import { updateBusiness } from '@/lib/db/queries'
import { db } from '@/lib/db'
import { businesses } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { encrypt } from '@/lib/crypto'

// Profile section (basic business info)
const profileSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  slug: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/, 'Only lowercase letters, numbers, and hyphens').optional(),
  type: z.enum(['clinic', 'salon', 'consultant', 'gym', 'other']).optional(),
  tagline: z.string().max(100).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  foundedYear: z.number().min(1900).max(2100).nullable().optional(),
})

// Branding section (logo and colors)
const brandingSchema = z.object({
  logoUrl: z.string().url().nullable().optional().or(z.literal('')),
  primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Must be a valid hex color').optional(),
})

// Legal section (German business registration)
const legalSchema = z.object({
  legalName: z.string().max(200).nullable().optional(),
  legalForm: z.string().max(50).nullable().optional(),
  registrationNumber: z.string().max(50).nullable().optional(),
  registrationCourt: z.string().max(100).nullable().optional(),
})

// Contact section
const contactSchema = z.object({
  email: z.string().email().nullable().optional().or(z.literal('')),
  phone: z.string().max(20).nullable().optional(),
  address: z.string().max(200).nullable().optional(),
  website: z.string().url().nullable().optional().or(z.literal('')),
})

// Social media section
const socialSchema = z.object({
  socialInstagram: z.string().max(50).nullable().optional(),
  socialFacebook: z.string().max(100).nullable().optional(),
  socialLinkedin: z.string().max(100).nullable().optional(),
  socialTwitter: z.string().max(50).nullable().optional(),
})

// Regional settings
const regionalSchema = z.object({
  timezone: z.string().optional(),
  currency: z.string().length(3).optional(),
})

// Booking policies
const policiesSchema = z.object({
  minBookingNoticeHours: z.number().min(0).max(168).optional(),
  maxAdvanceBookingDays: z.number().min(1).max(365).optional(),
  cancellationPolicyHours: z.number().min(0).max(168).optional(),
  requireApproval: z.boolean().optional(),
  requireEmailConfirmation: z.boolean().optional(),
  allowWaitlist: z.boolean().optional(),
})

// Tax settings (stored in JSONB)
const taxSchema = z.object({
  taxId: z.string().max(50).optional(),
  taxRate: z.number().min(0).max(100).optional(),
  isKleinunternehmer: z.boolean().optional(),
  showLogoOnInvoice: z.boolean().optional(),
})

// Data Control settings (GDPR/WhatsApp + EU AI Act compliance)
const dataControlSchema = z.object({
  privacyPolicyUrl: z.string().url().nullable().optional(),
  dataRetentionDays: z.number().min(30).max(3650).optional(),
  dpaAccepted: z.boolean().optional(),
  aiLiteracyAcknowledged: z.boolean().optional(),
  aiDisclosureMessage: z.string().max(500).optional(),
  userId: z.string().optional(), // Clerk user ID for audit trail
})

// AVV (Auftragsverarbeitungsvertrag) acceptance
const avvSchema = z.object({
  avvAccepted: z.boolean(),
  userId: z.string().optional(), // Clerk user ID for audit trail
})

// WhatsApp / Twilio BYOT settings
const whatsappSchema = z.object({
  twilioAccountSid: z.string().regex(/^AC[a-f0-9]{32}$/).optional().or(z.literal('')),
  twilioAuthToken: z.string().min(32).max(64).optional().or(z.literal('')),
  twilioWhatsappNumber: z.string().regex(/^\+[1-9]\d{7,14}$/).optional().or(z.literal('')),
  whatsappEnabled: z.boolean().optional(),
})

// Legacy schemas for backwards compatibility
const businessInfoSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  slug: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/, 'Only lowercase letters, numbers, and hyphens').optional(),
  type: z.enum(['clinic', 'salon', 'consultant', 'gym', 'other']).optional(),
  logoUrl: z.string().url().nullable().optional(),
  primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Must be a valid hex color').optional(),
})

/**
 * Mask WhatsApp credentials before sending to frontend.
 * Never expose encrypted auth token to the client.
 */
function maskWhatsAppCredentials(business: typeof businesses.$inferSelect) {
  const settings = (business.settings as Record<string, unknown>) || {}
  const masked = { ...settings }

  // Remove encrypted token, replace with mask + flag
  if (masked.twilioAuthTokenEncrypted) {
    delete masked.twilioAuthTokenEncrypted
    masked.twilioAuthToken = '••••••••'
    masked.hasTwilioAuthToken = true
  } else {
    masked.hasTwilioAuthToken = false
  }

  return { ...business, settings: masked }
}

export async function GET() {
  const authResult = await requireBusinessAuth()
  if (!authResult.success) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }

  return NextResponse.json({ business: maskWhatsAppCredentials(authResult.business) })
}

export async function PATCH(request: NextRequest) {
  const authResult = await requireBusinessAuth()
  if (!authResult.success) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }

  const body = await request.json()
  const { section } = body

  let parsed
  switch (section) {
    case 'profile':
      parsed = profileSchema.safeParse(body.data)
      break
    case 'branding':
      parsed = brandingSchema.safeParse(body.data)
      break
    case 'legal':
      parsed = legalSchema.safeParse(body.data)
      break
    case 'contact':
      parsed = contactSchema.safeParse(body.data)
      break
    case 'social':
      parsed = socialSchema.safeParse(body.data)
      break
    case 'regional':
      parsed = regionalSchema.safeParse(body.data)
      break
    case 'policies':
      parsed = policiesSchema.safeParse(body.data)
      break
    case 'tax':
      parsed = taxSchema.safeParse(body.data)
      break
    case 'dataControl':
      parsed = dataControlSchema.safeParse(body.data)
      break
    case 'avv':
      parsed = avvSchema.safeParse(body.data)
      break
    case 'whatsapp':
      parsed = whatsappSchema.safeParse(body.data)
      break
    // Legacy section name for backwards compatibility
    case 'business':
      parsed = businessInfoSchema.safeParse(body.data)
      break
    default:
      return NextResponse.json({ error: 'Invalid section' }, { status: 400 })
  }

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  // Handle tax section specially - it goes into the settings JSONB field
  if (section === 'tax') {
    const taxData = parsed.data as z.infer<typeof taxSchema>
    const currentSettings = (authResult.business.settings as Record<string, unknown>) || {}
    const newSettings = {
      ...currentSettings,
      taxId: taxData.taxId !== undefined ? (taxData.taxId || null) : currentSettings.taxId,
      taxRate: taxData.taxRate ?? currentSettings.taxRate ?? 19,
      isKleinunternehmer: taxData.isKleinunternehmer ?? currentSettings.isKleinunternehmer ?? false,
      showLogoOnInvoice: taxData.showLogoOnInvoice ?? currentSettings.showLogoOnInvoice ?? true,
    }

    const [updated] = await db
      .update(businesses)
      .set({
        settings: newSettings,
        updatedAt: new Date(),
      })
      .where(eq(businesses.id, authResult.business.id))
      .returning()

    return NextResponse.json({ business: updated })
  }

  // Handle dataControl section - GDPR/WhatsApp and EU AI Act compliance
  if (section === 'dataControl') {
    const dataControlData = parsed.data as z.infer<typeof dataControlSchema>
    const currentSettings = (authResult.business.settings as Record<string, unknown>) || {}
    const now = new Date().toISOString()

    const newSettings: Record<string, unknown> = {
      ...currentSettings,
      privacyPolicyUrl: dataControlData.privacyPolicyUrl ?? currentSettings.privacyPolicyUrl,
      dataRetentionDays: dataControlData.dataRetentionDays ?? currentSettings.dataRetentionDays ?? 365,
      aiDisclosureMessage: dataControlData.aiDisclosureMessage ?? currentSettings.aiDisclosureMessage,
    }

    // Handle DPA acceptance (only set if newly accepted)
    if (dataControlData.dpaAccepted && !currentSettings.dpaAcceptedAt) {
      newSettings.dpaAcceptedAt = now
      newSettings.dpaAcceptedBy = dataControlData.userId
    } else if (!dataControlData.dpaAccepted) {
      // Allow revoking (though this would be unusual)
      newSettings.dpaAcceptedAt = null
      newSettings.dpaAcceptedBy = null
    }

    // Handle AI literacy acknowledgment with versioning
    const AI_LITERACY_VERSION = '1.0'
    if (dataControlData.aiLiteracyAcknowledged) {
      // Only update if not already acknowledged with current version
      if (currentSettings.aiLiteracyVersion !== AI_LITERACY_VERSION) {
        newSettings.aiLiteracyAcknowledgedAt = now
        newSettings.aiLiteracyAcknowledgedBy = dataControlData.userId
        newSettings.aiLiteracyVersion = AI_LITERACY_VERSION
      }
    } else {
      // Clear acknowledgment if unchecked
      newSettings.aiLiteracyAcknowledgedAt = null
      newSettings.aiLiteracyAcknowledgedBy = null
      newSettings.aiLiteracyVersion = null
    }

    const [updated] = await db
      .update(businesses)
      .set({
        settings: newSettings,
        updatedAt: new Date(),
      })
      .where(eq(businesses.id, authResult.business.id))
      .returning()

    return NextResponse.json({ business: updated })
  }

  // Handle AVV (Auftragsverarbeitungsvertrag) acceptance
  if (section === 'avv') {
    const avvData = parsed.data as z.infer<typeof avvSchema>
    const currentSettings = (authResult.business.settings as Record<string, unknown>) || {}
    const now = new Date().toISOString()

    // Current AVV version - bump this when legal terms change
    const AVV_VERSION = '1.0'

    const newSettings: Record<string, unknown> = {
      ...currentSettings,
    }

    if (avvData.avvAccepted) {
      // Only update if not already accepted with current version
      if (currentSettings.avvVersion !== AVV_VERSION) {
        newSettings.avvAcceptedAt = now
        newSettings.avvAcceptedBy = avvData.userId
        newSettings.avvVersion = AVV_VERSION
      }
    } else {
      // Allow revoking (though this would be unusual in practice)
      newSettings.avvAcceptedAt = null
      newSettings.avvAcceptedBy = null
      newSettings.avvVersion = null
    }

    const [updated] = await db
      .update(businesses)
      .set({
        settings: newSettings,
        updatedAt: new Date(),
      })
      .where(eq(businesses.id, authResult.business.id))
      .returning()

    return NextResponse.json({ business: updated })
  }

  // Handle WhatsApp / Twilio BYOT settings
  if (section === 'whatsapp') {
    const whatsappData = parsed.data as z.infer<typeof whatsappSchema>
    const currentSettings = (authResult.business.settings as Record<string, unknown>) || {}

    const newSettings: Record<string, unknown> = {
      ...currentSettings,
      whatsappEnabled: whatsappData.whatsappEnabled ?? currentSettings.whatsappEnabled ?? false,
    }

    // Only update SID if provided
    if (whatsappData.twilioAccountSid !== undefined) {
      newSettings.twilioAccountSid = whatsappData.twilioAccountSid || null
    }

    // Only update phone if provided
    if (whatsappData.twilioWhatsappNumber !== undefined) {
      newSettings.twilioWhatsappNumber = whatsappData.twilioWhatsappNumber || null
    }

    // Encrypt auth token before storing (only if a new value is provided)
    if (whatsappData.twilioAuthToken) {
      newSettings.twilioAuthTokenEncrypted = encrypt(whatsappData.twilioAuthToken)
      // Clear verified status when credentials change
      newSettings.twilioVerifiedAt = null
      newSettings.twilioVerifiedBy = null
    }

    // Also clear verified status if SID changes
    if (whatsappData.twilioAccountSid && whatsappData.twilioAccountSid !== currentSettings.twilioAccountSid) {
      newSettings.twilioVerifiedAt = null
      newSettings.twilioVerifiedBy = null
    }

    const [updated] = await db
      .update(businesses)
      .set({
        settings: newSettings,
        updatedAt: new Date(),
      })
      .where(eq(businesses.id, authResult.business.id))
      .returning()

    return NextResponse.json({ business: maskWhatsAppCredentials(updated) })
  }

  // Handle empty strings as null for nullable fields
  const cleanedData = Object.fromEntries(
    Object.entries(parsed.data).map(([key, value]) => [
      key,
      value === '' ? null : value,
    ])
  )

  const updated = await updateBusiness(authResult.business.id, cleanedData)

  return NextResponse.json({ business: updated })
}
