-- Per-user agency access: the all_agencies flag + the user_agencies N:N table.
-- Applied in prod via the eco-migration lambda action `create-user-agencies-schema`
-- (idempotent). This file documents the schema change for the repo; drizzle-kit
-- is not run automatically here.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "all_agencies" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_agencies" (
	"user_id" uuid NOT NULL,
	"agency_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_agencies_user_id_agency_id_pk" PRIMARY KEY("user_id","agency_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_agencies" ADD CONSTRAINT "user_agencies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_agencies" ADD CONSTRAINT "user_agencies_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_user_agencies_user" ON "user_agencies" ("user_id");
