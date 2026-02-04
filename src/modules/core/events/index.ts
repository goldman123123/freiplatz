/**
 * Event Emitter Module
 *
 * Provides event-driven architecture using the outbox pattern.
 * Events are written to the database within transactions and processed asynchronously.
 *
 * This decouples business logic from side effects (emails, webhooks, etc.)
 * and ensures reliable event delivery with retry logic.
 */

import { db } from '@/lib/db'
import { eventOutbox } from '@/lib/db/schema'
import type { PgTransaction } from 'drizzle-orm/pg-core'
import type { ExtractTablesWithRelations } from 'drizzle-orm'
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js'
import type { PgInsertValue } from 'drizzle-orm/pg-core'

// ============================================
// EVENT TYPES
// ============================================

export type EventType =
  // Booking lifecycle
  | 'booking.created'
  | 'booking.confirmed'
  | 'booking.cancelled'
  | 'booking.reminded'
  | 'booking.completed'
  | 'booking.no_show'

  // Member management
  | 'member.invited'
  | 'member.joined'
  | 'member.removed'
  | 'member.role_changed'

  // Customer events
  | 'customer.created'
  | 'customer.updated'

  // Business events
  | 'business.created'
  | 'business.plan_changed'

// ============================================
// EVENT PAYLOADS
// ============================================

export interface BookingCreatedPayload {
  bookingId: string
  customerEmail: string
  customerName: string
  customerPhone?: string
  serviceName: string
  businessName: string
  businessEmail?: string
  staffName?: string
  startsAt: string  // ISO string
  endsAt: string    // ISO string
  price?: number
  currency: string
  confirmationToken?: string
  notes?: string
}

export interface BookingConfirmedPayload {
  bookingId: string
  customerEmail: string
  customerName: string
  serviceName: string
  businessName: string
  staffName?: string
  startsAt: string
  endsAt: string
  price?: number
  currency: string
  confirmationToken?: string
}

export interface BookingCancelledPayload {
  bookingId: string
  customerEmail: string
  customerName: string
  serviceName: string
  businessName: string
  staffName?: string
  startsAt: string
  endsAt: string
  reason?: string
  cancelledBy: 'customer' | 'staff' | 'system'
}

export interface BookingRemindedPayload {
  bookingId: string
  customerEmail: string
  customerName: string
  serviceName: string
  businessName: string
  staffName?: string
  startsAt: string
  endsAt: string
  confirmationToken?: string
}

export interface MemberInvitedPayload {
  memberId: string
  businessId: string
  businessName: string
  inviteeEmail: string
  inviteeName?: string
  inviterName: string
  role: string
  invitationUrl: string
}

export interface MemberJoinedPayload {
  memberId: string
  businessId: string
  businessName: string
  memberName: string
  memberEmail: string
  role: string
}

export interface CustomerCreatedPayload {
  customerId: string
  businessId: string
  businessName: string
  customerEmail: string
  customerName?: string
  customerPhone?: string
}

// Type mapping for event payloads
export type EventPayload<T extends EventType> =
  T extends 'booking.created' ? BookingCreatedPayload :
  T extends 'booking.confirmed' ? BookingConfirmedPayload :
  T extends 'booking.cancelled' ? BookingCancelledPayload :
  T extends 'booking.reminded' ? BookingRemindedPayload :
  T extends 'member.invited' ? MemberInvitedPayload :
  T extends 'member.joined' ? MemberJoinedPayload :
  T extends 'customer.created' ? CustomerCreatedPayload :
  Record<string, unknown>

// ============================================
// EVENT EMITTER
// ============================================

/**
 * Emit an event to the outbox within a transaction.
 * The event will be processed asynchronously by the event processor.
 *
 * @param tx - Database transaction
 * @param businessId - Business that owns this event
 * @param eventType - Type of event
 * @param payload - Event data
 */
export async function emitEvent<T extends EventType>(
  tx: PgTransaction<PostgresJsQueryResultHKT, typeof import('@/lib/db/schema'), ExtractTablesWithRelations<typeof import('@/lib/db/schema')>>,
  businessId: string,
  eventType: T,
  payload: EventPayload<T>
): Promise<void> {
  await tx.insert(eventOutbox).values({
    businessId,
    eventType,
    payload: payload as Record<string, unknown>,
    attempts: 0,
    maxAttempts: 3,
  })
}

/**
 * Emit an event outside of a transaction (standalone).
 * Use this only when you're not already in a transaction.
 * Prefer emitEvent() within transactions for consistency.
 *
 * @param businessId - Business that owns this event
 * @param eventType - Type of event
 * @param payload - Event data
 */
export async function emitEventStandalone<T extends EventType>(
  businessId: string,
  eventType: T,
  payload: EventPayload<T>
): Promise<void> {
  await db.insert(eventOutbox).values({
    businessId,
    eventType,
    payload: payload as Record<string, unknown>,
    attempts: 0,
    maxAttempts: 3,
  })
}

// ============================================
// HELPERS
// ============================================

/**
 * Get a human-readable description of an event type (in German).
 */
export function getEventTypeDescription(eventType: EventType): string {
  const descriptions: Record<EventType, string> = {
    'booking.created': 'Buchung erstellt',
    'booking.confirmed': 'Buchung bestätigt',
    'booking.cancelled': 'Buchung storniert',
    'booking.reminded': 'Buchung erinnert',
    'booking.completed': 'Buchung abgeschlossen',
    'booking.no_show': 'Kunde nicht erschienen',

    'member.invited': 'Mitglied eingeladen',
    'member.joined': 'Mitglied beigetreten',
    'member.removed': 'Mitglied entfernt',
    'member.role_changed': 'Mitgliederrolle geändert',

    'customer.created': 'Kunde erstellt',
    'customer.updated': 'Kunde aktualisiert',

    'business.created': 'Platz erstellt',
    'business.plan_changed': 'Tarif geändert',
  }

  return descriptions[eventType] || eventType
}
