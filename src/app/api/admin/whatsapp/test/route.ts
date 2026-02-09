/**
 * WhatsApp Connection Test
 *
 * POST /api/admin/whatsapp/test
 *
 * Decrypts stored Twilio credentials, verifies the account,
 * and updates twilioVerifiedAt on success.
 */

import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { requireBusinessAuth } from '@/lib/auth'
import { decrypt } from '@/lib/crypto'
import { db } from '@/lib/db'
import { businesses } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import twilio from 'twilio'

export async function POST() {
  try {
    const authResult = await requireBusinessAuth()
    if (!authResult.success) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const settings = (authResult.business.settings as Record<string, unknown>) || {}
    const sid = settings.twilioAccountSid as string | undefined
    const encryptedToken = settings.twilioAuthTokenEncrypted as string | undefined

    if (!sid || !encryptedToken) {
      return NextResponse.json(
        { success: false, error: 'Twilio-Zugangsdaten sind nicht vollständig konfiguriert.' },
        { status: 400 }
      )
    }

    // Decrypt the auth token
    let authToken: string
    try {
      authToken = decrypt(encryptedToken)
    } catch {
      return NextResponse.json(
        { success: false, error: 'Entschlüsselung fehlgeschlagen. Bitte speichern Sie den Auth-Token erneut.' },
        { status: 400 }
      )
    }

    // Test the credentials by fetching account info
    try {
      const client = twilio(sid, authToken)
      const account = await client.api.v2010.accounts(sid).fetch()

      // Mark as verified
      const { userId } = await auth()
      const now = new Date().toISOString()

      const [updated] = await db
        .update(businesses)
        .set({
          settings: {
            ...settings,
            twilioVerifiedAt: now,
            twilioVerifiedBy: userId,
          },
          updatedAt: new Date(),
        })
        .where(eq(businesses.id, authResult.business.id))
        .returning()

      return NextResponse.json({
        success: true,
        accountName: account.friendlyName,
        accountStatus: account.status,
      })
    } catch (twilioError: any) {
      console.error('[WhatsApp Test] Twilio API error:', twilioError.message)
      return NextResponse.json({
        success: false,
        error: `Twilio-Verbindung fehlgeschlagen: ${twilioError.message}`,
      })
    }
  } catch (error: any) {
    console.error('[WhatsApp Test] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Interner Serverfehler' },
      { status: 500 }
    )
  }
}
