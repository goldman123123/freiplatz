-- ============================================
-- FREIPLATZ PLATFORM SPINE - MULTI-TENANT SAAS UPGRADE
-- Migration: 0001_platform_spine_multi_tenant
-- ============================================

-- Enable btree_gist extension for exclusion constraints
CREATE EXTENSION IF NOT EXISTS btree_gist;

--> statement-breakpoint

-- ============================================
-- CREATE NEW TABLES
-- ============================================

-- Business Members (Multi-Tenant Membership)
CREATE TABLE "business_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"clerk_user_id" text NOT NULL,
	"role" text DEFAULT 'staff' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"invited_by" uuid,
	"invited_at" timestamp with time zone,
	"joined_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Event Outbox (Async Event Processing)
CREATE TABLE "event_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"last_error" text,
	"next_retry_at" timestamp with time zone
);
--> statement-breakpoint

-- ============================================
-- ALTER BUSINESSES TABLE
-- ============================================

-- Add plan fields
ALTER TABLE "businesses" ADD COLUMN "plan_id" text DEFAULT 'free';
--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "plan_started_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "plan_expires_at" timestamp with time zone;
--> statement-breakpoint

-- Drop unique constraint on clerk_user_id (multi-tenant support)
ALTER TABLE "businesses" DROP CONSTRAINT IF EXISTS "businesses_clerk_user_id_unique";
--> statement-breakpoint

-- Make clerk_user_id nullable (legacy field)
ALTER TABLE "businesses" ALTER COLUMN "clerk_user_id" DROP NOT NULL;
--> statement-breakpoint

-- ============================================
-- FIX TIMESTAMPS (timestamp → timestamptz)
-- ============================================

-- Businesses
ALTER TABLE "businesses" ALTER COLUMN "created_at" TYPE timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "businesses" ALTER COLUMN "updated_at" TYPE timestamp with time zone;
--> statement-breakpoint

-- Services
ALTER TABLE "services" ALTER COLUMN "created_at" TYPE timestamp with time zone;
--> statement-breakpoint

-- Staff
ALTER TABLE "staff" ALTER COLUMN "created_at" TYPE timestamp with time zone;
--> statement-breakpoint

-- Availability Templates
ALTER TABLE "availability_templates" ALTER COLUMN "created_at" TYPE timestamp with time zone;
--> statement-breakpoint

-- Availability Overrides
ALTER TABLE "availability_overrides" ALTER COLUMN "created_at" TYPE timestamp with time zone;
--> statement-breakpoint

-- Customers
ALTER TABLE "customers" ALTER COLUMN "created_at" TYPE timestamp with time zone;
--> statement-breakpoint

-- Bookings
ALTER TABLE "bookings" ALTER COLUMN "starts_at" TYPE timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "ends_at" TYPE timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "created_at" TYPE timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "confirmed_at" TYPE timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "cancelled_at" TYPE timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now();
--> statement-breakpoint

-- Waitlist
ALTER TABLE "waitlist" ALTER COLUMN "created_at" TYPE timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "waitlist" ALTER COLUMN "notified_at" TYPE timestamp with time zone;
--> statement-breakpoint

-- ============================================
-- ADD FOREIGN KEYS
-- ============================================

-- Business Members
ALTER TABLE "business_members" ADD CONSTRAINT "business_members_business_id_businesses_id_fk"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "business_members" ADD CONSTRAINT "business_members_invited_by_business_members_id_fk"
  FOREIGN KEY ("invited_by") REFERENCES "business_members"("id") ON DELETE SET NULL;
--> statement-breakpoint

-- Event Outbox
ALTER TABLE "event_outbox" ADD CONSTRAINT "event_outbox_business_id_businesses_id_fk"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;
--> statement-breakpoint

-- ============================================
-- CREATE INDEXES
-- ============================================

-- Business Members indexes
CREATE UNIQUE INDEX "business_members_business_user_idx" ON "business_members" ("business_id", "clerk_user_id");
--> statement-breakpoint
CREATE INDEX "business_members_clerk_user_idx" ON "business_members" ("clerk_user_id");
--> statement-breakpoint

-- Event Outbox indexes (for efficient unprocessed event queries)
CREATE INDEX "event_outbox_unprocessed_idx" ON "event_outbox" ("created_at", "attempts", "processed_at");
--> statement-breakpoint
CREATE INDEX "event_outbox_business_idx" ON "event_outbox" ("business_id");
--> statement-breakpoint

-- ============================================
-- MIGRATE EXISTING DATA
-- ============================================

-- Migrate existing business owners to business_members
-- All existing businesses with clerk_user_id become owners
INSERT INTO "business_members" ("business_id", "clerk_user_id", "role", "status", "joined_at", "created_at", "updated_at")
SELECT
  "id" as business_id,
  "clerk_user_id",
  'owner' as role,
  'active' as status,
  "created_at" as joined_at,
  "created_at",
  now() as updated_at
FROM "businesses"
WHERE "clerk_user_id" IS NOT NULL;
--> statement-breakpoint

-- ============================================
-- ADD DOUBLE-BOOKING PROTECTION
-- ============================================

-- Exclusion constraint: prevent overlapping bookings for same staff
-- Uses btree_gist extension for efficient range overlap detection
ALTER TABLE "bookings" ADD CONSTRAINT "no_overlapping_bookings"
  EXCLUDE USING gist (
    staff_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  )
  WHERE (status NOT IN ('cancelled', 'no_show'));
--> statement-breakpoint

-- ============================================
-- MIGRATION COMPLETE
-- ============================================

-- Summary:
-- ✓ Multi-tenant membership system (business_members table)
-- ✓ Async event processing (event_outbox table)
-- ✓ Plan management fields added to businesses
-- ✓ All timestamps converted to TIMESTAMPTZ
-- ✓ Existing owners migrated to business_members
-- ✓ Double-booking protection via exclusion constraint
-- ✓ clerk_user_id is now nullable (legacy field)
