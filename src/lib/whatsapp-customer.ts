/**
 * WhatsApp Customer Lookup/Create (Direct DB)
 *
 * Replaces self-fetching /api/whatsapp/customer from the webhook.
 * Direct DB queries avoid cold-start loops on Vercel.
 */

import { db } from '@/lib/db'
import { customers } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { formatE164Phone } from '@/lib/whatsapp-phone-formatter'

export async function findOrCreateWhatsAppCustomer(
  phone: string,
  businessId: string
): Promise<{ customerId: string; created: boolean }> {
  const normalizedPhone = formatE164Phone(phone)

  // Check if customer already exists
  const existing = await db
    .select({ id: customers.id })
    .from(customers)
    .where(
      and(
        eq(customers.businessId, businessId),
        eq(customers.phone, normalizedPhone)
      )
    )
    .limit(1)
    .then(rows => rows[0])

  if (existing) {
    return { customerId: existing.id, created: false }
  }

  // Create new customer
  const [newCustomer] = await db
    .insert(customers)
    .values({
      businessId,
      phone: normalizedPhone,
      name: 'WhatsApp Customer',
      source: 'whatsapp',
      whatsappOptInStatus: 'UNSET',
    })
    .returning({ id: customers.id })

  return { customerId: newCustomer.id, created: true }
}
