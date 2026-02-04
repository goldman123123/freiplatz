/**
 * Multi-Tenant Auth Module
 *
 * Handles authentication and business membership for the multi-tenant platform.
 * Users can be members of multiple businesses with different roles.
 */

import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/db'
import { businesses, businessMembers } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

// ============================================
// TYPES
// ============================================

export type BusinessMember = typeof businessMembers.$inferSelect
export type Business = typeof businesses.$inferSelect

export interface BusinessWithMembership {
  business: Business
  member: BusinessMember
}

export type MultiTenantAuthResult =
  | { success: true; userId: string; businesses: BusinessWithMembership[] }
  | { success: false; error: string; status: 401 | 404 }

export type BusinessAccessResult =
  | { success: true; userId: string; business: Business; member: BusinessMember }
  | { success: false; error: string; status: 401 | 403 | 404 }

// ============================================
// CORE AUTH FUNCTIONS
// ============================================

/**
 * Get all businesses the current user is a member of.
 * Returns empty array if user has no memberships.
 */
export async function getBusinessesForUser(clerkUserId: string): Promise<BusinessWithMembership[]> {
  const memberships = await db
    .select({
      member: businessMembers,
      business: businesses,
    })
    .from(businessMembers)
    .innerJoin(businesses, eq(businessMembers.businessId, businesses.id))
    .where(and(
      eq(businessMembers.clerkUserId, clerkUserId),
      eq(businessMembers.status, 'active')
    ))
    .orderBy(businessMembers.createdAt)

  return memberships.map(m => ({
    business: m.business,
    member: m.member,
  }))
}

/**
 * Get the current user's authentication status and all their businesses.
 */
export async function requireAuth(): Promise<MultiTenantAuthResult> {
  const { userId } = await auth()

  if (!userId) {
    return { success: false, error: 'Nicht authentifiziert', status: 401 }
  }

  const businesses = await getBusinessesForUser(userId)

  if (businesses.length === 0) {
    return {
      success: false,
      error: 'Kein Platz gefunden. Bitte schließen Sie das Onboarding ab oder nehmen Sie eine Einladung an.',
      status: 404
    }
  }

  return { success: true, userId, businesses }
}

/**
 * Get membership details for a specific user and business.
 * Returns null if user is not a member of the business.
 */
export async function getMembership(
  clerkUserId: string,
  businessId: string
): Promise<BusinessMember | null> {
  const results = await db
    .select()
    .from(businessMembers)
    .where(and(
      eq(businessMembers.clerkUserId, clerkUserId),
      eq(businessMembers.businessId, businessId),
      eq(businessMembers.status, 'active')
    ))
    .limit(1)

  return results[0] || null
}

/**
 * Require access to a specific business.
 * Verifies that the current user is an active member of the business.
 *
 * @param businessId - The business to access
 * @returns Authentication result with business and membership details
 */
export async function requireBusinessAccess(businessId: string): Promise<BusinessAccessResult> {
  const { userId } = await auth()

  if (!userId) {
    return { success: false, error: 'Nicht authentifiziert', status: 401 }
  }

  // Get business
  const businessResults = await db
    .select()
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1)

  const business = businessResults[0]

  if (!business) {
    return { success: false, error: 'Platz nicht gefunden', status: 404 }
  }

  // Get membership
  const member = await getMembership(userId, businessId)

  if (!member) {
    return {
      success: false,
      error: 'Zugriff verweigert. Sie sind kein Mitglied dieses Platzes.',
      status: 403
    }
  }

  return { success: true, userId, business, member }
}

/**
 * Get the first business for a user (for backward compatibility).
 * This matches the behavior of the legacy requireBusinessAuth().
 *
 * @deprecated Use requireBusinessAccess() or requireAuth() for multi-tenant support
 */
export async function getFirstBusinessForUser(clerkUserId: string): Promise<Business | null> {
  const businesses = await getBusinessesForUser(clerkUserId)
  return businesses[0]?.business || null
}

// ============================================
// INVITATION & MEMBERSHIP
// ============================================

/**
 * Check if a user has a pending invitation to a business.
 */
export async function getPendingInvitation(
  clerkUserId: string,
  businessId: string
): Promise<BusinessMember | null> {
  const results = await db
    .select()
    .from(businessMembers)
    .where(and(
      eq(businessMembers.clerkUserId, clerkUserId),
      eq(businessMembers.businessId, businessId),
      eq(businessMembers.status, 'invited')
    ))
    .limit(1)

  return results[0] || null
}

/**
 * Get all pending invitations for a user.
 */
export async function getPendingInvitations(clerkUserId: string): Promise<BusinessWithMembership[]> {
  const invitations = await db
    .select({
      member: businessMembers,
      business: businesses,
    })
    .from(businessMembers)
    .innerJoin(businesses, eq(businessMembers.businessId, businesses.id))
    .where(and(
      eq(businessMembers.clerkUserId, clerkUserId),
      eq(businessMembers.status, 'invited')
    ))
    .orderBy(businessMembers.invitedAt)

  return invitations.map(i => ({
    business: i.business,
    member: i.member,
  }))
}

/**
 * Accept an invitation and activate membership.
 */
export async function acceptInvitation(memberId: string): Promise<void> {
  await db
    .update(businessMembers)
    .set({
      status: 'active',
      joinedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(businessMembers.id, memberId))
}

/**
 * Decline an invitation (soft delete).
 */
export async function declineInvitation(memberId: string): Promise<void> {
  await db
    .update(businessMembers)
    .set({
      status: 'disabled',
      updatedAt: new Date(),
    })
    .where(eq(businessMembers.id, memberId))
}
