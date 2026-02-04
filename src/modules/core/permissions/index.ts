/**
 * Permissions Module
 *
 * Role-based access control (RBAC) for the multi-tenant platform.
 * Defines permissions for different roles and provides authorization checks.
 *
 * Roles:
 * - owner: Full access to everything (creator of the business)
 * - admin: Full access except deleting business and managing billing
 * - staff: Limited access - can manage bookings and customers (read-only for services/staff)
 */

import { BusinessMember } from '../auth'

// ============================================
// PERMISSION DEFINITIONS
// ============================================

export type Permission =
  // Business management
  | 'business:read'
  | 'business:update'
  | 'business:delete'

  // Member management
  | 'members:read'
  | 'members:invite'
  | 'members:update'
  | 'members:remove'

  // Service management
  | 'services:read'
  | 'services:create'
  | 'services:update'
  | 'services:delete'

  // Staff management
  | 'staff:read'
  | 'staff:create'
  | 'staff:update'
  | 'staff:delete'

  // Booking management
  | 'bookings:read'
  | 'bookings:create'
  | 'bookings:update'
  | 'bookings:delete'

  // Customer management
  | 'customers:read'
  | 'customers:create'
  | 'customers:update'
  | 'customers:delete'

  // Settings & configuration
  | 'settings:read'
  | 'settings:update'
  | 'settings:availability'

  // Billing & plan management
  | 'billing:read'
  | 'billing:update'

export type Role = 'owner' | 'admin' | 'staff'

// ============================================
// ROLE PERMISSIONS
// ============================================

const rolePermissions: Record<Role, Permission[]> = {
  owner: [
    // Business
    'business:read',
    'business:update',
    'business:delete',

    // Members
    'members:read',
    'members:invite',
    'members:update',
    'members:remove',

    // Services
    'services:read',
    'services:create',
    'services:update',
    'services:delete',

    // Staff
    'staff:read',
    'staff:create',
    'staff:update',
    'staff:delete',

    // Bookings
    'bookings:read',
    'bookings:create',
    'bookings:update',
    'bookings:delete',

    // Customers
    'customers:read',
    'customers:create',
    'customers:update',
    'customers:delete',

    // Settings
    'settings:read',
    'settings:update',
    'settings:availability',

    // Billing
    'billing:read',
    'billing:update',
  ],

  admin: [
    // Business (cannot delete)
    'business:read',
    'business:update',

    // Members (can invite and manage)
    'members:read',
    'members:invite',
    'members:update',
    'members:remove',

    // Services
    'services:read',
    'services:create',
    'services:update',
    'services:delete',

    // Staff
    'staff:read',
    'staff:create',
    'staff:update',
    'staff:delete',

    // Bookings
    'bookings:read',
    'bookings:create',
    'bookings:update',
    'bookings:delete',

    // Customers
    'customers:read',
    'customers:create',
    'customers:update',
    'customers:delete',

    // Settings (cannot manage billing)
    'settings:read',
    'settings:update',
    'settings:availability',

    // Billing (read-only)
    'billing:read',
  ],

  staff: [
    // Business (read-only)
    'business:read',

    // Members (cannot manage)

    // Services (read-only)
    'services:read',

    // Staff (read-only)
    'staff:read',

    // Bookings (full access)
    'bookings:read',
    'bookings:create',
    'bookings:update',
    'bookings:delete',

    // Customers (full access)
    'customers:read',
    'customers:create',
    'customers:update',
    'customers:delete',

    // Settings (read-only)
    'settings:read',

    // Billing (no access)
  ],
}

// ============================================
// PERMISSION CHECKS
// ============================================

/**
 * Check if a member has a specific permission based on their role.
 */
export function hasPermission(member: BusinessMember, permission: Permission): boolean {
  const role = member.role as Role

  if (!role || !rolePermissions[role]) {
    return false
  }

  return rolePermissions[role].includes(permission)
}

/**
 * Check if a member has ALL of the specified permissions.
 */
export function hasAllPermissions(member: BusinessMember, permissions: Permission[]): boolean {
  return permissions.every(permission => hasPermission(member, permission))
}

/**
 * Check if a member has ANY of the specified permissions.
 */
export function hasAnyPermission(member: BusinessMember, permissions: Permission[]): boolean {
  return permissions.some(permission => hasPermission(member, permission))
}

/**
 * Require a specific permission. Throws ForbiddenError if denied.
 */
export function requirePermission(member: BusinessMember, permission: Permission): void {
  if (!hasPermission(member, permission)) {
    throw new ForbiddenError(
      `Zugriff verweigert. Erforderliche Berechtigung: ${permission}. Ihre Rolle: ${member.role}`
    )
  }
}

/**
 * Require ALL of the specified permissions. Throws ForbiddenError if any are denied.
 */
export function requireAllPermissions(member: BusinessMember, permissions: Permission[]): void {
  const missingPermissions = permissions.filter(p => !hasPermission(member, p))

  if (missingPermissions.length > 0) {
    throw new ForbiddenError(
      `Zugriff verweigert. Fehlende Berechtigungen: ${missingPermissions.join(', ')}. Ihre Rolle: ${member.role}`
    )
  }
}

/**
 * Require ANY of the specified permissions. Throws ForbiddenError if none match.
 */
export function requireAnyPermission(member: BusinessMember, permissions: Permission[]): void {
  if (!hasAnyPermission(member, permissions)) {
    throw new ForbiddenError(
      `Zugriff verweigert. Eine der folgenden Berechtigungen erforderlich: ${permissions.join(', ')}. Ihre Rolle: ${member.role}`
    )
  }
}

/**
 * Check if a member is an owner.
 */
export function isOwner(member: BusinessMember): boolean {
  return member.role === 'owner'
}

/**
 * Check if a member is an owner or admin.
 */
export function isOwnerOrAdmin(member: BusinessMember): boolean {
  return member.role === 'owner' || member.role === 'admin'
}

/**
 * Require owner role. Throws ForbiddenError if not owner.
 */
export function requireOwner(member: BusinessMember): void {
  if (!isOwner(member)) {
    throw new ForbiddenError(
      `Zugriff verweigert. Nur der Platz-Besitzer kann diese Aktion ausführen. Ihre Rolle: ${member.role}`
    )
  }
}

/**
 * Require owner or admin role. Throws ForbiddenError if neither.
 */
export function requireOwnerOrAdmin(member: BusinessMember): void {
  if (!isOwnerOrAdmin(member)) {
    throw new ForbiddenError(
      `Zugriff verweigert. Nur Besitzer oder Administratoren können diese Aktion ausführen. Ihre Rolle: ${member.role}`
    )
  }
}

// ============================================
// CUSTOM ERRORS
// ============================================

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ForbiddenError'
  }
}

export class UnauthorizedError extends Error {
  constructor(message: string = 'Nicht authentifiziert') {
    super(message)
    this.name = 'UnauthorizedError'
  }
}

// ============================================
// PERMISSION HELPERS
// ============================================

/**
 * Get all permissions for a role.
 */
export function getPermissionsForRole(role: Role): Permission[] {
  return rolePermissions[role] || []
}

/**
 * Get a readable description of a role (in German).
 */
export function getRoleDescription(role: Role): string {
  const descriptions: Record<Role, string> = {
    owner: 'Besitzer - Vollzugriff auf alle Funktionen',
    admin: 'Administrator - Voller Zugriff außer Löschen und Abrechnung',
    staff: 'Personal - Zugriff auf Buchungen und Kunden',
  }

  return descriptions[role] || role
}

/**
 * Get a readable description of a permission (in German).
 */
export function getPermissionDescription(permission: Permission): string {
  const descriptions: Record<Permission, string> = {
    'business:read': 'Platzinformationen anzeigen',
    'business:update': 'Platzinformationen bearbeiten',
    'business:delete': 'Platz löschen',

    'members:read': 'Mitglieder anzeigen',
    'members:invite': 'Mitglieder einladen',
    'members:update': 'Mitgliederrollen ändern',
    'members:remove': 'Mitglieder entfernen',

    'services:read': 'Dienste anzeigen',
    'services:create': 'Dienste erstellen',
    'services:update': 'Dienste bearbeiten',
    'services:delete': 'Dienste löschen',

    'staff:read': 'Personal anzeigen',
    'staff:create': 'Personal hinzufügen',
    'staff:update': 'Personal bearbeiten',
    'staff:delete': 'Personal entfernen',

    'bookings:read': 'Buchungen anzeigen',
    'bookings:create': 'Buchungen erstellen',
    'bookings:update': 'Buchungen bearbeiten',
    'bookings:delete': 'Buchungen stornieren',

    'customers:read': 'Kunden anzeigen',
    'customers:create': 'Kunden hinzufügen',
    'customers:update': 'Kunden bearbeiten',
    'customers:delete': 'Kunden löschen',

    'settings:read': 'Einstellungen anzeigen',
    'settings:update': 'Einstellungen bearbeiten',
    'settings:availability': 'Verfügbarkeit verwalten',

    'billing:read': 'Abrechnungsdetails anzeigen',
    'billing:update': 'Tarif ändern und Zahlung verwalten',
  }

  return descriptions[permission] || permission
}
