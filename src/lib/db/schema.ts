import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  decimal,
  time,
  date,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ============================================
// BUSINESSES (Tenants)
// ============================================

export const businesses = pgTable('businesses', {
  id: uuid('id').defaultRandom().primaryKey(),
  clerkUserId: text('clerk_user_id'), // Legacy field - kept for backward compatibility, no longer unique
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(), // URL: freiplatz.app/book/[slug]
  type: text('type').notNull(), // 'clinic', 'salon', 'consultant', 'gym'

  // Branding
  logoUrl: text('logo_url'),
  primaryColor: text('primary_color').default('#3B82F6'),

  // Location
  timezone: text('timezone').default('Europe/Berlin'),
  currency: text('currency').default('EUR'),

  // Contact
  email: text('email'),
  phone: text('phone'),
  address: text('address'),
  website: text('website'),

  // Booking policies
  minBookingNoticeHours: integer('min_booking_notice_hours').default(24),
  maxAdvanceBookingDays: integer('max_advance_booking_days').default(60),
  cancellationPolicyHours: integer('cancellation_policy_hours').default(24),
  allowWaitlist: boolean('allow_waitlist').default(true),
  requireApproval: boolean('require_approval').default(false),

  // Plan & billing
  planId: text('plan_id').default('free'), // free, starter, pro, business
  planStartedAt: timestamp('plan_started_at', { withTimezone: true }),
  planExpiresAt: timestamp('plan_expires_at', { withTimezone: true }),

  // Flexible settings (branding, notifications, etc.)
  settings: jsonb('settings').default({}),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ============================================
// BUSINESS MEMBERS (Multi-Tenant)
// ============================================

export const businessMembers = pgTable('business_members', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id').notNull().references(() => businesses.id, { onDelete: 'cascade' }),
  clerkUserId: text('clerk_user_id').notNull(),

  // Role: owner, admin, staff
  role: text('role').notNull().default('staff'),

  // Status: invited, active, disabled
  status: text('status').notNull().default('active'),

  // Invitation tracking
  invitedBy: uuid('invited_by').references(() => businessMembers.id),
  invitedAt: timestamp('invited_at', { withTimezone: true }),
  joinedAt: timestamp('joined_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  businessUserIdx: uniqueIndex('business_members_business_user_idx').on(table.businessId, table.clerkUserId),
  clerkUserIdx: index('business_members_clerk_user_idx').on(table.clerkUserId),
}));

// ============================================
// EVENT OUTBOX (Async Processing)
// ============================================

export const eventOutbox = pgTable('event_outbox', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id').notNull().references(() => businesses.id, { onDelete: 'cascade' }),

  // Event type: booking.created, booking.confirmed, booking.cancelled, member.invited, etc.
  eventType: text('event_type').notNull(),

  // Event payload (JSON)
  payload: jsonb('payload').notNull(),

  // Processing tracking
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  attempts: integer('attempts').default(0).notNull(),
  maxAttempts: integer('max_attempts').default(3).notNull(),
  lastError: text('last_error'),

  nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
}, (table) => ({
  // Index for fetching unprocessed events
  unprocessedIdx: index('event_outbox_unprocessed_idx').on(table.createdAt, table.attempts, table.processedAt),
  businessIdx: index('event_outbox_business_idx').on(table.businessId),
}));

// ============================================
// SERVICES
// ============================================

export const services = pgTable('services', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id').notNull().references(() => businesses.id, { onDelete: 'cascade' }),

  name: text('name').notNull(),
  description: text('description'),
  durationMinutes: integer('duration_minutes').notNull(),
  bufferMinutes: integer('buffer_minutes').default(0),
  price: decimal('price', { precision: 10, scale: 2 }),
  category: text('category'),

  isActive: boolean('is_active').default(true),
  sortOrder: integer('sort_order').default(0),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  businessIdx: index('services_business_idx').on(table.businessId),
}));

// ============================================
// STAFF / PROVIDERS
// ============================================

export const staff = pgTable('staff', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id').notNull().references(() => businesses.id, { onDelete: 'cascade' }),

  name: text('name').notNull(),
  email: text('email'),
  phone: text('phone'),
  title: text('title'), // "Physical Therapist", "Stylist"
  bio: text('bio'),
  avatarUrl: text('avatar_url'),

  isActive: boolean('is_active').default(true),

  // Google Calendar integration
  googleCalendarId: text('google_calendar_id'),
  googleRefreshToken: text('google_refresh_token'),

  settings: jsonb('settings').default({}),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  businessIdx: index('staff_business_idx').on(table.businessId),
}));

// Staff <-> Services (many-to-many)
export const staffServices = pgTable('staff_services', {
  staffId: uuid('staff_id').notNull().references(() => staff.id, { onDelete: 'cascade' }),
  serviceId: uuid('service_id').notNull().references(() => services.id, { onDelete: 'cascade' }),
}, (table) => ({
  pk: uniqueIndex('staff_services_pk').on(table.staffId, table.serviceId),
}));

// ============================================
// AVAILABILITY
// ============================================

export const availabilityTemplates = pgTable('availability_templates', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id').notNull().references(() => businesses.id, { onDelete: 'cascade' }),
  staffId: uuid('staff_id').references(() => staff.id, { onDelete: 'cascade' }), // NULL = business default

  name: text('name').default('Default'),
  isDefault: boolean('is_default').default(false),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const availabilitySlots = pgTable('availability_slots', {
  id: uuid('id').defaultRandom().primaryKey(),
  templateId: uuid('template_id').notNull().references(() => availabilityTemplates.id, { onDelete: 'cascade' }),

  dayOfWeek: integer('day_of_week').notNull(), // 0=Sun, 6=Sat
  startTime: time('start_time').notNull(),
  endTime: time('end_time').notNull(),
}, (table) => ({
  templateIdx: index('availability_slots_template_idx').on(table.templateId),
}));

// Date-specific overrides (holidays, special hours, time off)
export const availabilityOverrides = pgTable('availability_overrides', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id').notNull().references(() => businesses.id, { onDelete: 'cascade' }),
  staffId: uuid('staff_id').references(() => staff.id, { onDelete: 'cascade' }), // NULL = all staff

  date: date('date').notNull(),
  isAvailable: boolean('is_available').default(false), // false = day off
  startTime: time('start_time'), // if available, custom hours
  endTime: time('end_time'),
  reason: text('reason'),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  businessDateIdx: index('availability_overrides_business_date_idx').on(table.businessId, table.date),
}));

// ============================================
// CUSTOMERS
// ============================================

export const customers = pgTable('customers', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id').notNull().references(() => businesses.id, { onDelete: 'cascade' }),

  email: text('email').notNull(),
  name: text('name'),
  phone: text('phone'),
  notes: text('notes'), // internal notes

  customFields: jsonb('custom_fields').default({}),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  businessEmailIdx: uniqueIndex('customers_business_email_idx').on(table.businessId, table.email),
}));

// ============================================
// BOOKINGS
// ============================================

export const bookings = pgTable('bookings', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id').notNull().references(() => businesses.id, { onDelete: 'cascade' }),
  serviceId: uuid('service_id').references(() => services.id),
  staffId: uuid('staff_id').references(() => staff.id),
  customerId: uuid('customer_id').references(() => customers.id),

  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),

  // Status: pending | confirmed | cancelled | completed | no_show
  status: text('status').default('pending'),

  // Token for customer actions (cancel/confirm links)
  confirmationToken: uuid('confirmation_token').defaultRandom(),

  // Google Calendar sync
  googleEventId: text('google_event_id'),

  // Details
  price: decimal('price', { precision: 10, scale: 2 }),
  notes: text('notes'), // customer notes
  internalNotes: text('internal_notes'), // staff notes
  source: text('source').default('web'), // web, api, admin, import

  customFields: jsonb('custom_fields').default({}),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancellationReason: text('cancellation_reason'),
  cancelledBy: text('cancelled_by'), // 'customer', 'staff', 'system'
}, (table) => ({
  businessDateIdx: index('bookings_business_date_idx').on(table.businessId, table.startsAt),
  staffDateIdx: index('bookings_staff_date_idx').on(table.staffId, table.startsAt),
  statusIdx: index('bookings_status_idx').on(table.status),
  tokenIdx: index('bookings_token_idx').on(table.confirmationToken),
}));

// ============================================
// WAITLIST
// ============================================

export const waitlist = pgTable('waitlist', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id').notNull().references(() => businesses.id, { onDelete: 'cascade' }),
  customerId: uuid('customer_id').references(() => customers.id),
  serviceId: uuid('service_id').references(() => services.id),
  staffId: uuid('staff_id').references(() => staff.id), // NULL = any staff

  preferredDates: jsonb('preferred_dates'), // array of date ranges

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  notifiedAt: timestamp('notified_at', { withTimezone: true }),
  convertedBookingId: uuid('converted_booking_id').references(() => bookings.id),
});

// ============================================
// RELATIONS
// ============================================

export const businessesRelations = relations(businesses, ({ many }) => ({
  members: many(businessMembers),
  events: many(eventOutbox),
  services: many(services),
  staff: many(staff),
  customers: many(customers),
  bookings: many(bookings),
  availabilityTemplates: many(availabilityTemplates),
  availabilityOverrides: many(availabilityOverrides),
}));

export const businessMembersRelations = relations(businessMembers, ({ one }) => ({
  business: one(businesses, {
    fields: [businessMembers.businessId],
    references: [businesses.id],
  }),
  inviter: one(businessMembers, {
    fields: [businessMembers.invitedBy],
    references: [businessMembers.id],
  }),
}));

export const eventOutboxRelations = relations(eventOutbox, ({ one }) => ({
  business: one(businesses, {
    fields: [eventOutbox.businessId],
    references: [businesses.id],
  }),
}));

export const servicesRelations = relations(services, ({ one, many }) => ({
  business: one(businesses, {
    fields: [services.businessId],
    references: [businesses.id],
  }),
  staffServices: many(staffServices),
  bookings: many(bookings),
}));

export const staffRelations = relations(staff, ({ one, many }) => ({
  business: one(businesses, {
    fields: [staff.businessId],
    references: [businesses.id],
  }),
  staffServices: many(staffServices),
  bookings: many(bookings),
  availabilityTemplates: many(availabilityTemplates),
}));

export const customersRelations = relations(customers, ({ one, many }) => ({
  business: one(businesses, {
    fields: [customers.businessId],
    references: [businesses.id],
  }),
  bookings: many(bookings),
}));

export const bookingsRelations = relations(bookings, ({ one }) => ({
  business: one(businesses, {
    fields: [bookings.businessId],
    references: [businesses.id],
  }),
  service: one(services, {
    fields: [bookings.serviceId],
    references: [services.id],
  }),
  staff: one(staff, {
    fields: [bookings.staffId],
    references: [staff.id],
  }),
  customer: one(customers, {
    fields: [bookings.customerId],
    references: [customers.id],
  }),
}));
