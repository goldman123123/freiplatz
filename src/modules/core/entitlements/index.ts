/**
 * Entitlements Module
 *
 * Manages plan-based feature access and resource limits.
 * Defines plans and provides functions to check entitlements.
 *
 * Plans:
 * - Free: 1 seat, bookings only
 * - Starter: 3 seats, bookings + branding
 * - Pro: 10 seats, bookings + branding + chatbot + tickets + analytics
 * - Business: Unlimited seats, all features (+ inventory + API + whitelabel)
 */

import { db } from '@/lib/db'
import { businessMembers } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { Business } from '../auth'

// ============================================
// PLAN DEFINITIONS
// ============================================

export type PlanId = 'free' | 'starter' | 'pro' | 'business'

export type Feature =
  | 'bookings'           // Core booking functionality
  | 'branding'           // Custom colors, logo
  | 'chatbot'            // AI chatbot for lead capture
  | 'tickets'            // Support ticket system
  | 'analytics'          // Advanced analytics dashboard
  | 'inventory'          // Inventory management
  | 'api'                // REST API access
  | 'whitelabel'         // Remove Freiplatz branding
  | 'sms'                // SMS notifications
  | 'calendar_sync'      // Google Calendar sync
  | 'custom_domain'      // Custom domain support

export interface Plan {
  id: PlanId
  name: string
  description: string
  seatLimit: number | null  // null = unlimited
  features: Feature[]
  price: {
    monthly: number    // in EUR
    yearly: number     // in EUR
  }
}

const plans: Record<PlanId, Plan> = {
  free: {
    id: 'free',
    name: 'Free',
    description: '1 Platz, nur Buchungen',
    seatLimit: 1,
    features: ['bookings'],
    price: {
      monthly: 0,
      yearly: 0,
    },
  },

  starter: {
    id: 'starter',
    name: 'Starter',
    description: '3 Plätze, Buchungen + Branding',
    seatLimit: 3,
    features: ['bookings', 'branding', 'sms', 'calendar_sync'],
    price: {
      monthly: 29,
      yearly: 290,  // 2 months free
    },
  },

  pro: {
    id: 'pro',
    name: 'Pro',
    description: '10 Plätze, Buchungen + Branding + Chatbot + Tickets + Analytics',
    seatLimit: 10,
    features: [
      'bookings',
      'branding',
      'chatbot',
      'tickets',
      'analytics',
      'sms',
      'calendar_sync',
      'custom_domain',
    ],
    price: {
      monthly: 99,
      yearly: 990,  // 2 months free
    },
  },

  business: {
    id: 'business',
    name: 'Business',
    description: 'Unbegrenzte Plätze, alle Features',
    seatLimit: null,  // Unlimited
    features: [
      'bookings',
      'branding',
      'chatbot',
      'tickets',
      'analytics',
      'inventory',
      'api',
      'whitelabel',
      'sms',
      'calendar_sync',
      'custom_domain',
    ],
    price: {
      monthly: 299,
      yearly: 2990,  // 2 months free
    },
  },
}

// ============================================
// PLAN HELPERS
// ============================================

/**
 * Get plan details by ID.
 */
export function getPlan(planId: PlanId): Plan {
  return plans[planId] || plans.free
}

/**
 * Get all available plans.
 */
export function getAllPlans(): Plan[] {
  return Object.values(plans)
}

/**
 * Get plan for a business.
 */
export function getBusinessPlan(business: Business): Plan {
  const planId = (business.planId as PlanId) || 'free'
  return getPlan(planId)
}

// ============================================
// FEATURE CHECKS
// ============================================

/**
 * Check if a business has access to a specific feature.
 */
export function hasFeature(business: Business, feature: Feature): boolean {
  const plan = getBusinessPlan(business)
  return plan.features.includes(feature)
}

/**
 * Check if a business has ALL of the specified features.
 */
export function hasAllFeatures(business: Business, features: Feature[]): boolean {
  return features.every(feature => hasFeature(business, feature))
}

/**
 * Check if a business has ANY of the specified features.
 */
export function hasAnyFeature(business: Business, features: Feature[]): boolean {
  return features.some(feature => hasFeature(business, feature))
}

/**
 * Require a specific feature. Throws FeatureNotAvailableError if not entitled.
 */
export function requireFeature(business: Business, feature: Feature): void {
  if (!hasFeature(business, feature)) {
    const plan = getBusinessPlan(business)
    throw new FeatureNotAvailableError(
      `Feature nicht verfügbar. "${getFeatureDescription(feature)}" erfordert ein Upgrade. Aktueller Tarif: ${plan.name}`
    )
  }
}

/**
 * Require ALL of the specified features. Throws FeatureNotAvailableError if any are missing.
 */
export function requireAllFeatures(business: Business, features: Feature[]): void {
  const missingFeatures = features.filter(f => !hasFeature(business, f))

  if (missingFeatures.length > 0) {
    const plan = getBusinessPlan(business)
    const featureNames = missingFeatures.map(f => getFeatureDescription(f)).join(', ')
    throw new FeatureNotAvailableError(
      `Features nicht verfügbar: ${featureNames}. Aktueller Tarif: ${plan.name}. Bitte upgraden.`
    )
  }
}

// ============================================
// SEAT LIMIT CHECKS
// ============================================

/**
 * Get the number of active members (seats used) for a business.
 */
export async function getSeatsUsed(businessId: string): Promise<number> {
  const results = await db
    .select({ id: businessMembers.id })
    .from(businessMembers)
    .where(and(
      eq(businessMembers.businessId, businessId),
      eq(businessMembers.status, 'active')
    ))

  return results.length
}

/**
 * Get the number of remaining seats for a business.
 * Returns null if unlimited seats.
 */
export async function getSeatsRemaining(business: Business): Promise<number | null> {
  const plan = getBusinessPlan(business)

  if (plan.seatLimit === null) {
    return null  // Unlimited
  }

  const used = await getSeatsUsed(business.id)
  return Math.max(0, plan.seatLimit - used)
}

/**
 * Check if a business can add another member (has seats available).
 */
export async function canAddMember(business: Business): Promise<boolean> {
  const plan = getBusinessPlan(business)

  if (plan.seatLimit === null) {
    return true  // Unlimited
  }

  const used = await getSeatsUsed(business.id)
  return used < plan.seatLimit
}

/**
 * Require that the business has at least one seat available.
 * Throws SeatLimitError if no seats remaining.
 */
export async function requireSeatsAvailable(business: Business): Promise<void> {
  if (!(await canAddMember(business))) {
    const plan = getBusinessPlan(business)
    const used = await getSeatsUsed(business.id)

    throw new SeatLimitError(
      `Mitgliederlimit erreicht. ${plan.name}-Tarif erlaubt ${plan.seatLimit} ${
        plan.seatLimit === 1 ? 'Platz' : 'Plätze'
      } (${used} aktuell belegt). Bitte upgraden Sie Ihren Tarif, um weitere Mitglieder hinzuzufügen.`
    )
  }
}

// ============================================
// CUSTOM ERRORS
// ============================================

export class FeatureNotAvailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FeatureNotAvailableError'
  }
}

export class SeatLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SeatLimitError'
  }
}

// ============================================
// FEATURE DESCRIPTIONS
// ============================================

/**
 * Get a readable description of a feature (in German).
 */
export function getFeatureDescription(feature: Feature): string {
  const descriptions: Record<Feature, string> = {
    bookings: 'Buchungssystem',
    branding: 'Individuelles Branding (Logo, Farben)',
    chatbot: 'KI-Chatbot für Lead-Generierung',
    tickets: 'Support-Ticket-System',
    analytics: 'Erweiterte Analytik',
    inventory: 'Bestandsverwaltung',
    api: 'REST-API-Zugriff',
    whitelabel: 'Freiplatz-Branding entfernen',
    sms: 'SMS-Benachrichtigungen',
    calendar_sync: 'Google Kalender-Synchronisierung',
    custom_domain: 'Benutzerdefinierte Domain',
  }

  return descriptions[feature] || feature
}

/**
 * Get all features with descriptions.
 */
export function getAllFeatures(): Array<{ feature: Feature; description: string }> {
  const allFeatures: Feature[] = [
    'bookings',
    'branding',
    'chatbot',
    'tickets',
    'analytics',
    'inventory',
    'api',
    'whitelabel',
    'sms',
    'calendar_sync',
    'custom_domain',
  ]

  return allFeatures.map(feature => ({
    feature,
    description: getFeatureDescription(feature),
  }))
}

// ============================================
// PLAN COMPARISON HELPERS
// ============================================

/**
 * Check if a plan upgrade would unlock a specific feature.
 */
export function wouldUnlockFeature(currentPlanId: PlanId, targetPlanId: PlanId, feature: Feature): boolean {
  const current = getPlan(currentPlanId)
  const target = getPlan(targetPlanId)

  return !current.features.includes(feature) && target.features.includes(feature)
}

/**
 * Get features that would be unlocked by upgrading to a target plan.
 */
export function getUnlockedFeatures(currentPlanId: PlanId, targetPlanId: PlanId): Feature[] {
  const current = getPlan(currentPlanId)
  const target = getPlan(targetPlanId)

  return target.features.filter(f => !current.features.includes(f))
}
