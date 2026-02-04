CREATE TABLE "business_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"clerk_user_id" text NOT NULL,
	"role" text DEFAULT 'staff' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"invited_by" uuid,
	"invited_at" timestamp with time zone,
	"joined_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
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
ALTER TABLE "businesses" DROP CONSTRAINT "businesses_clerk_user_id_unique";--> statement-breakpoint
ALTER TABLE "availability_overrides" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "availability_overrides" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "availability_templates" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "availability_templates" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "starts_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "ends_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "confirmed_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "cancelled_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "businesses" ALTER COLUMN "clerk_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "businesses" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "businesses" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "businesses" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "services" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "services" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "staff" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "staff" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "waitlist" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "waitlist" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "waitlist" ALTER COLUMN "notified_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now();--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "plan_id" text DEFAULT 'free';--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "plan_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "plan_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "business_members" ADD CONSTRAINT "business_members_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_members" ADD CONSTRAINT "business_members_invited_by_business_members_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."business_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_outbox" ADD CONSTRAINT "event_outbox_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "business_members_business_user_idx" ON "business_members" USING btree ("business_id","clerk_user_id");--> statement-breakpoint
CREATE INDEX "business_members_clerk_user_idx" ON "business_members" USING btree ("clerk_user_id");--> statement-breakpoint
CREATE INDEX "event_outbox_unprocessed_idx" ON "event_outbox" USING btree ("created_at","attempts","processed_at");--> statement-breakpoint
CREATE INDEX "event_outbox_business_idx" ON "event_outbox" USING btree ("business_id");--> statement-breakpoint
-- Enable btree_gist extension for exclusion constraints
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
-- Migrate existing business owners to business_members table
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
WHERE "clerk_user_id" IS NOT NULL;--> statement-breakpoint
-- Add double-booking protection (exclusion constraint)
ALTER TABLE "bookings" ADD CONSTRAINT "no_overlapping_bookings"
  EXCLUDE USING gist (
    staff_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  )
  WHERE (status NOT IN ('cancelled', 'no_show'));