import { db } from './index'
import {
  businesses,
  businessMembers,
  services,
  staff,
  staffServices,
  availabilityTemplates,
  availabilitySlots,
  availabilityOverrides,
  customers,
  bookings
} from './schema'
import { eq, and, gte, lte, sql, desc, asc, isNull, or, inArray } from 'drizzle-orm'

// ============================================
// BUSINESS QUERIES
// ============================================

export async function getBusinessBySlug(slug: string) {
  const results = await db
    .select()
    .from(businesses)
    .where(eq(businesses.slug, slug))
    .limit(1)
  return results[0] || null
}

export async function getBusinessById(id: string) {
  const results = await db
    .select()
    .from(businesses)
    .where(eq(businesses.id, id))
    .limit(1)
  return results[0] || null
}

export async function getBusinessForUser(clerkUserId: string) {
  const results = await db
    .select()
    .from(businesses)
    .where(eq(businesses.clerkUserId, clerkUserId))
    .limit(1)
  return results[0] || null
}

export async function createBusinessForUser(data: {
  clerkUserId: string
  name: string
  slug: string
  type: string
  timezone?: string
  email?: string
}) {
  const result = await db
    .insert(businesses)
    .values({
      clerkUserId: data.clerkUserId,
      name: data.name,
      slug: data.slug,
      type: data.type,
      timezone: data.timezone || 'Europe/Berlin',
      email: data.email,
    })
    .returning()

  return result[0]
}

// ============================================
// OWNERSHIP VERIFICATION
// ============================================

export async function verifyServiceOwnership(serviceId: string, businessId: string): Promise<boolean> {
  const result = await db
    .select({ id: services.id })
    .from(services)
    .where(and(
      eq(services.id, serviceId),
      eq(services.businessId, businessId)
    ))
    .limit(1)
  return result.length > 0
}

export async function verifyStaffOwnership(staffId: string, businessId: string): Promise<boolean> {
  const result = await db
    .select({ id: staff.id })
    .from(staff)
    .where(and(
      eq(staff.id, staffId),
      eq(staff.businessId, businessId)
    ))
    .limit(1)
  return result.length > 0
}

export async function verifyBookingOwnership(bookingId: string, businessId: string): Promise<boolean> {
  const result = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(
      eq(bookings.id, bookingId),
      eq(bookings.businessId, businessId)
    ))
    .limit(1)
  return result.length > 0
}

export async function verifyTemplateOwnership(templateId: string, businessId: string): Promise<boolean> {
  const result = await db
    .select({ id: availabilityTemplates.id })
    .from(availabilityTemplates)
    .where(and(
      eq(availabilityTemplates.id, templateId),
      eq(availabilityTemplates.businessId, businessId)
    ))
    .limit(1)
  return result.length > 0
}

export async function verifyOverrideOwnership(overrideId: string, businessId: string): Promise<boolean> {
  const result = await db
    .select({ id: availabilityOverrides.id })
    .from(availabilityOverrides)
    .where(and(
      eq(availabilityOverrides.id, overrideId),
      eq(availabilityOverrides.businessId, businessId)
    ))
    .limit(1)
  return result.length > 0
}

// ============================================
// SERVICE QUERIES
// ============================================

export async function getServicesByBusiness(businessId: string) {
  return db
    .select()
    .from(services)
    .where(and(
      eq(services.businessId, businessId),
      eq(services.isActive, true)
    ))
    .orderBy(asc(services.sortOrder), asc(services.name))
}

export async function getServiceById(serviceId: string, businessId: string) {
  const results = await db
    .select()
    .from(services)
    .where(and(
      eq(services.id, serviceId),
      eq(services.businessId, businessId)
    ))
    .limit(1)
  return results[0] || null
}

// ============================================
// STAFF QUERIES
// ============================================

export async function getStaffByBusiness(businessId: string) {
  return db
    .select()
    .from(staff)
    .where(and(
      eq(staff.businessId, businessId),
      eq(staff.isActive, true)
    ))
    .orderBy(asc(staff.name))
}

export async function getStaffById(staffId: string, businessId: string) {
  const results = await db
    .select()
    .from(staff)
    .where(and(
      eq(staff.id, staffId),
      eq(staff.businessId, businessId)
    ))
    .limit(1)
  return results[0] || null
}

export async function getStaffForService(serviceId: string) {
  return db
    .select({
      id: staff.id,
      name: staff.name,
      title: staff.title,
      avatarUrl: staff.avatarUrl,
      bio: staff.bio,
    })
    .from(staff)
    .innerJoin(staffServices, eq(staff.id, staffServices.staffId))
    .where(and(
      eq(staffServices.serviceId, serviceId),
      eq(staff.isActive, true)
    ))
    .orderBy(asc(staff.name))
}

// ============================================
// AVAILABILITY QUERIES
// ============================================

export async function getAvailabilityTemplate(businessId: string, staffId?: string) {
  // Try to get staff-specific template first
  if (staffId) {
    const staffTemplates = await db
      .select()
      .from(availabilityTemplates)
      .where(and(
        eq(availabilityTemplates.businessId, businessId),
        eq(availabilityTemplates.staffId, staffId),
        eq(availabilityTemplates.isDefault, true)
      ))
      .limit(1)

    if (staffTemplates[0]) return staffTemplates[0]
  }

  // Fall back to business default
  const businessTemplates = await db
    .select()
    .from(availabilityTemplates)
    .where(and(
      eq(availabilityTemplates.businessId, businessId),
      isNull(availabilityTemplates.staffId),
      eq(availabilityTemplates.isDefault, true)
    ))
    .limit(1)

  return businessTemplates[0] || null
}

export async function getAvailabilitySlots(templateId: string) {
  return db
    .select()
    .from(availabilitySlots)
    .where(eq(availabilitySlots.templateId, templateId))
    .orderBy(asc(availabilitySlots.dayOfWeek), asc(availabilitySlots.startTime))
}

export async function getAvailabilityOverrides(
  businessId: string,
  startDate: Date,
  endDate: Date,
  staffId?: string
) {
  const baseCondition = and(
    eq(availabilityOverrides.businessId, businessId),
    gte(availabilityOverrides.date, startDate.toISOString().split('T')[0]),
    lte(availabilityOverrides.date, endDate.toISOString().split('T')[0])
  )

  if (staffId) {
    return db
      .select()
      .from(availabilityOverrides)
      .where(and(
        baseCondition,
        or(
          eq(availabilityOverrides.staffId, staffId),
          isNull(availabilityOverrides.staffId)
        )
      ))
  }

  return db
    .select()
    .from(availabilityOverrides)
    .where(and(
      baseCondition,
      isNull(availabilityOverrides.staffId)
    ))
}

// ============================================
// BOOKING QUERIES
// ============================================

export async function getBookingsForDateRange(
  businessId: string,
  startDate: Date,
  endDate: Date,
  staffId?: string
) {
  const conditions = [
    eq(bookings.businessId, businessId),
    gte(bookings.startsAt, startDate),
    lte(bookings.startsAt, endDate),
    sql`${bookings.status} NOT IN ('cancelled')`,
  ]

  if (staffId) {
    conditions.push(eq(bookings.staffId, staffId))
  }

  return db
    .select()
    .from(bookings)
    .where(and(...conditions))
    .orderBy(asc(bookings.startsAt))
}

export async function getBookingById(bookingId: string) {
  const results = await db
    .select({
      booking: bookings,
      service: services,
      staffMember: staff,
      customer: customers,
    })
    .from(bookings)
    .leftJoin(services, eq(bookings.serviceId, services.id))
    .leftJoin(staff, eq(bookings.staffId, staff.id))
    .leftJoin(customers, eq(bookings.customerId, customers.id))
    .where(eq(bookings.id, bookingId))
    .limit(1)

  return results[0] || null
}

export async function getBookingByToken(token: string) {
  const results = await db
    .select({
      booking: bookings,
      service: services,
      staffMember: staff,
      customer: customers,
      business: businesses,
    })
    .from(bookings)
    .leftJoin(services, eq(bookings.serviceId, services.id))
    .leftJoin(staff, eq(bookings.staffId, staff.id))
    .leftJoin(customers, eq(bookings.customerId, customers.id))
    .leftJoin(businesses, eq(bookings.businessId, businesses.id))
    .where(eq(bookings.confirmationToken, token))
    .limit(1)

  return results[0] || null
}

export async function getRecentBookings(businessId: string, limit = 50) {
  return db
    .select({
      booking: bookings,
      service: services,
      staffMember: staff,
      customer: customers,
    })
    .from(bookings)
    .leftJoin(services, eq(bookings.serviceId, services.id))
    .leftJoin(staff, eq(bookings.staffId, staff.id))
    .leftJoin(customers, eq(bookings.customerId, customers.id))
    .where(eq(bookings.businessId, businessId))
    .orderBy(desc(bookings.createdAt))
    .limit(limit)
}

export async function getTodaysBookings(businessId: string) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  return db
    .select({
      booking: bookings,
      service: services,
      staffMember: staff,
      customer: customers,
    })
    .from(bookings)
    .leftJoin(services, eq(bookings.serviceId, services.id))
    .leftJoin(staff, eq(bookings.staffId, staff.id))
    .leftJoin(customers, eq(bookings.customerId, customers.id))
    .where(and(
      eq(bookings.businessId, businessId),
      gte(bookings.startsAt, today),
      lte(bookings.startsAt, tomorrow),
      sql`${bookings.status} NOT IN ('cancelled')`
    ))
    .orderBy(asc(bookings.startsAt))
}

// ============================================
// CUSTOMER QUERIES
// ============================================

export async function getOrCreateCustomer(
  businessId: string,
  email: string,
  name?: string,
  phone?: string
) {
  // Try to find existing customer
  const existing = await db
    .select()
    .from(customers)
    .where(and(
      eq(customers.businessId, businessId),
      eq(customers.email, email)
    ))
    .limit(1)

  if (existing[0]) {
    // Update name/phone if provided and different
    if ((name && name !== existing[0].name) || (phone && phone !== existing[0].phone)) {
      await db
        .update(customers)
        .set({
          ...(name && { name }),
          ...(phone && { phone }),
        })
        .where(eq(customers.id, existing[0].id))
    }
    return existing[0]
  }

  // Create new customer
  const inserted = await db
    .insert(customers)
    .values({
      businessId,
      email,
      name,
      phone,
    })
    .returning()

  return inserted[0]
}

// ============================================
// BOOKING CREATION
// ============================================

export async function createBooking(data: {
  businessId: string
  serviceId: string
  staffId?: string
  customerId: string
  startsAt: Date
  endsAt: Date
  price?: string
  notes?: string
  source?: string
}) {
  const inserted = await db
    .insert(bookings)
    .values({
      businessId: data.businessId,
      serviceId: data.serviceId,
      staffId: data.staffId,
      customerId: data.customerId,
      startsAt: data.startsAt,
      endsAt: data.endsAt,
      price: data.price,
      notes: data.notes,
      source: data.source || 'web',
      status: 'pending',
    })
    .returning()

  return inserted[0]
}

// ============================================
// DASHBOARD STATS
// ============================================

export async function getBookingStats(businessId: string) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const weekAgo = new Date(today)
  weekAgo.setDate(weekAgo.getDate() - 7)

  const [todayCount, weekCount, pendingCount, totalCount] = await Promise.all([
    db.select({ count: sql<number>`count(*)` })
      .from(bookings)
      .where(and(
        eq(bookings.businessId, businessId),
        gte(bookings.startsAt, today),
        lte(bookings.startsAt, tomorrow),
        sql`${bookings.status} NOT IN ('cancelled')`
      )),
    db.select({ count: sql<number>`count(*)` })
      .from(bookings)
      .where(and(
        eq(bookings.businessId, businessId),
        gte(bookings.createdAt, weekAgo),
        sql`${bookings.status} NOT IN ('cancelled')`
      )),
    db.select({ count: sql<number>`count(*)` })
      .from(bookings)
      .where(and(
        eq(bookings.businessId, businessId),
        eq(bookings.status, 'pending')
      )),
    db.select({ count: sql<number>`count(*)` })
      .from(bookings)
      .where(eq(bookings.businessId, businessId)),
  ])

  return {
    todayBookings: Number(todayCount[0]?.count || 0),
    weekBookings: Number(weekCount[0]?.count || 0),
    pendingBookings: Number(pendingCount[0]?.count || 0),
    totalBookings: Number(totalCount[0]?.count || 0),
  }
}

// ============================================
// BOOKING MUTATIONS
// ============================================

export async function updateBookingStatus(
  bookingId: string,
  businessId: string,
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no_show',
  options?: {
    cancellationReason?: string
    cancelledBy?: 'customer' | 'staff' | 'system'
    internalNotes?: string
  }
) {
  const updateData: Record<string, unknown> = { status }

  if (status === 'confirmed') {
    updateData.confirmedAt = new Date()
  } else if (status === 'cancelled') {
    updateData.cancelledAt = new Date()
    if (options?.cancellationReason) {
      updateData.cancellationReason = options.cancellationReason
    }
    if (options?.cancelledBy) {
      updateData.cancelledBy = options.cancelledBy
    }
  }

  if (options?.internalNotes) {
    updateData.internalNotes = options.internalNotes
  }

  const result = await db
    .update(bookings)
    .set(updateData)
    .where(and(
      eq(bookings.id, bookingId),
      eq(bookings.businessId, businessId)
    ))
    .returning()

  return result[0]
}

export async function getBookingsByStatus(businessId: string, status?: string) {
  const conditions = [eq(bookings.businessId, businessId)]

  if (status && status !== 'all') {
    conditions.push(eq(bookings.status, status))
  }

  return db
    .select({
      booking: bookings,
      service: services,
      staffMember: staff,
      customer: customers,
    })
    .from(bookings)
    .leftJoin(services, eq(bookings.serviceId, services.id))
    .leftJoin(staff, eq(bookings.staffId, staff.id))
    .leftJoin(customers, eq(bookings.customerId, customers.id))
    .where(and(...conditions))
    .orderBy(desc(bookings.createdAt))
    .limit(100)
}

// ============================================
// SERVICE MUTATIONS
// ============================================

export async function getAllServices(businessId: string) {
  return db
    .select()
    .from(services)
    .where(eq(services.businessId, businessId))
    .orderBy(asc(services.sortOrder), asc(services.name))
}

export async function createService(data: {
  businessId: string
  name: string
  description?: string | null
  category?: string | null
  durationMinutes: number
  bufferMinutes?: number
  price?: string | null
  isActive?: boolean
}) {
  const result = await db
    .insert(services)
    .values({
      businessId: data.businessId,
      name: data.name,
      description: data.description,
      category: data.category,
      durationMinutes: data.durationMinutes,
      bufferMinutes: data.bufferMinutes || 0,
      price: data.price,
      isActive: data.isActive ?? true,
    })
    .returning()

  return result[0]
}

export async function updateService(
  serviceId: string,
  data: {
    name?: string
    description?: string | null
    category?: string | null
    durationMinutes?: number
    bufferMinutes?: number
    price?: string | null
    isActive?: boolean
  }
) {
  const result = await db
    .update(services)
    .set(data)
    .where(eq(services.id, serviceId))
    .returning()

  return result[0]
}

export async function deleteService(serviceId: string) {
  // Soft delete - set inactive
  return updateService(serviceId, { isActive: false })
}

// ============================================
// STAFF MUTATIONS
// ============================================

export async function getAllStaff(businessId: string) {
  return db
    .select()
    .from(staff)
    .where(eq(staff.businessId, businessId))
    .orderBy(asc(staff.name))
}

export async function getStaffWithServices(staffId: string, businessId: string) {
  const staffMember = await getStaffById(staffId, businessId)
  if (!staffMember) return null

  const serviceIds = await db
    .select({ serviceId: staffServices.serviceId })
    .from(staffServices)
    .where(eq(staffServices.staffId, staffId))

  return {
    ...staffMember,
    serviceIds: serviceIds.map(s => s.serviceId),
  }
}

export async function createStaff(data: {
  businessId: string
  name: string
  email?: string | null
  phone?: string | null
  title?: string | null
  bio?: string | null
  avatarUrl?: string | null
  isActive?: boolean
  serviceIds?: string[]
}) {
  const { serviceIds, ...staffData } = data

  const result = await db
    .insert(staff)
    .values({
      businessId: staffData.businessId,
      name: staffData.name,
      email: staffData.email,
      phone: staffData.phone,
      title: staffData.title,
      bio: staffData.bio,
      avatarUrl: staffData.avatarUrl,
      isActive: staffData.isActive ?? true,
    })
    .returning()

  const newStaff = result[0]

  // Assign services if provided
  if (serviceIds && serviceIds.length > 0) {
    await updateStaffServices(newStaff.id, serviceIds, staffData.businessId)
  }

  return newStaff
}

export async function updateStaff(
  staffId: string,
  data: {
    name?: string
    email?: string | null
    phone?: string | null
    title?: string | null
    bio?: string | null
    avatarUrl?: string | null
    isActive?: boolean
  }
) {
  const result = await db
    .update(staff)
    .set(data)
    .where(eq(staff.id, staffId))
    .returning()

  return result[0]
}

export async function deleteStaff(staffId: string) {
  // Soft delete - set inactive
  return updateStaff(staffId, { isActive: false })
}

export async function updateStaffServices(staffId: string, serviceIds: string[], businessId: string) {
  return await db.transaction(async (tx) => {
    // Verify staff belongs to business
    const staffMember = await tx
      .select({ id: staff.id })
      .from(staff)
      .where(and(
        eq(staff.id, staffId),
        eq(staff.businessId, businessId)
      ))
      .limit(1)

    if (!staffMember[0]) {
      throw new Error('Personal nicht gefunden oder Zugriff verweigert')
    }

    // Verify all services belong to same business
    if (serviceIds.length > 0) {
      const validServices = await tx
        .select({ id: services.id })
        .from(services)
        .where(and(
          inArray(services.id, serviceIds),
          eq(services.businessId, businessId)
        ))

      if (validServices.length !== serviceIds.length) {
        throw new Error('Ungültige Dienst-IDs oder Zugriff verweigert')
      }
    }

    // Delete existing assignments
    await tx
      .delete(staffServices)
      .where(eq(staffServices.staffId, staffId))

    // Insert new assignments
    if (serviceIds.length > 0) {
      await tx
        .insert(staffServices)
        .values(serviceIds.map(serviceId => ({
          staffId,
          serviceId,
        })))
    }
  })
}

// ============================================
// AVAILABILITY MUTATIONS
// ============================================

export async function getAvailabilityTemplatesWithSlots(businessId: string, staffId?: string | null) {
  const conditions = [eq(availabilityTemplates.businessId, businessId)]

  if (staffId) {
    conditions.push(eq(availabilityTemplates.staffId, staffId))
  } else {
    conditions.push(isNull(availabilityTemplates.staffId))
  }

  const templates = await db
    .select()
    .from(availabilityTemplates)
    .where(and(...conditions))

  if (templates.length === 0) return []

  const templatesWithSlots = await Promise.all(
    templates.map(async (template) => {
      const slots = await getAvailabilitySlots(template.id)
      return { ...template, slots }
    })
  )

  return templatesWithSlots
}

export async function createAvailabilityTemplate(data: {
  businessId: string
  staffId?: string | null
  name?: string
  isDefault?: boolean
}) {
  const result = await db
    .insert(availabilityTemplates)
    .values({
      businessId: data.businessId,
      staffId: data.staffId,
      name: data.name || 'Default',
      isDefault: data.isDefault ?? true,
    })
    .returning()

  return result[0]
}

export async function updateAvailabilityTemplateSlots(
  templateId: string,
  slots: { dayOfWeek: number; startTime: string; endTime: string }[]
) {
  // Delete existing slots
  await db
    .delete(availabilitySlots)
    .where(eq(availabilitySlots.templateId, templateId))

  // Insert new slots
  if (slots.length > 0) {
    await db
      .insert(availabilitySlots)
      .values(slots.map(slot => ({
        templateId,
        dayOfWeek: slot.dayOfWeek,
        startTime: slot.startTime,
        endTime: slot.endTime,
      })))
  }
}

export async function getOrCreateDefaultTemplate(businessId: string, staffId?: string | null) {
  const templates = await getAvailabilityTemplatesWithSlots(businessId, staffId)

  if (templates.length > 0) {
    return templates.find(t => t.isDefault) || templates[0]
  }

  // Create default template
  return createAvailabilityTemplate({
    businessId,
    staffId,
    name: staffId ? 'Staff Schedule' : 'Business Hours',
    isDefault: true,
  })
}

export async function getAllAvailabilityOverrides(businessId: string) {
  return db
    .select({
      override: availabilityOverrides,
      staffMember: staff,
    })
    .from(availabilityOverrides)
    .leftJoin(staff, eq(availabilityOverrides.staffId, staff.id))
    .where(eq(availabilityOverrides.businessId, businessId))
    .orderBy(asc(availabilityOverrides.date))
}

export async function createAvailabilityOverride(data: {
  businessId: string
  staffId?: string | null
  date: string
  isAvailable: boolean
  startTime?: string | null
  endTime?: string | null
  reason?: string | null
}) {
  const result = await db
    .insert(availabilityOverrides)
    .values({
      businessId: data.businessId,
      staffId: data.staffId,
      date: data.date,
      isAvailable: data.isAvailable,
      startTime: data.startTime,
      endTime: data.endTime,
      reason: data.reason,
    })
    .returning()

  return result[0]
}

export async function deleteAvailabilityOverride(overrideId: string) {
  await db
    .delete(availabilityOverrides)
    .where(eq(availabilityOverrides.id, overrideId))
}

// ============================================
// BUSINESS MUTATIONS
// ============================================

export async function updateBusiness(
  businessId: string,
  data: {
    name?: string
    slug?: string
    type?: string
    logoUrl?: string | null
    primaryColor?: string | null
    email?: string | null
    phone?: string | null
    address?: string | null
    website?: string | null
    timezone?: string
    currency?: string
    minBookingNoticeHours?: number
    maxAdvanceBookingDays?: number
    cancellationPolicyHours?: number
    requireApproval?: boolean
    allowWaitlist?: boolean
  }
) {
  const result = await db
    .update(businesses)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(businesses.id, businessId))
    .returning()

  return result[0]
}

// ============================================
// MEMBER MANAGEMENT
// ============================================

export async function getBusinessMembers(businessId: string) {
  return db
    .select()
    .from(businessMembers)
    .where(eq(businessMembers.businessId, businessId))
    .orderBy(desc(businessMembers.createdAt))
}

export async function createBusinessMember(data: {
  businessId: string
  clerkUserId: string
  role: string
  status: string
  invitedBy?: string
}) {
  const result = (await db
    .insert(businessMembers)
    .values({
      businessId: data.businessId,
      clerkUserId: data.clerkUserId,
      role: data.role,
      status: data.status,
      invitedBy: data.invitedBy,
      invitedAt: data.status === 'invited' ? new Date() : null,
      joinedAt: data.status === 'active' ? new Date() : null,
    })
    .returning()) as any[]

  return result[0]
}

export async function updateMemberRole(memberId: string, role: string) {
  const result = await db
    .update(businessMembers)
    .set({
      role,
      updatedAt: new Date(),
    })
    .where(eq(businessMembers.id, memberId))
    .returning()

  return result[0]
}

export async function removeMember(memberId: string) {
  await db
    .delete(businessMembers)
    .where(eq(businessMembers.id, memberId))
}

export async function getMemberById(memberId: string) {
  const results = await db
    .select()
    .from(businessMembers)
    .where(eq(businessMembers.id, memberId))
    .limit(1)

  return results[0] || null
}
