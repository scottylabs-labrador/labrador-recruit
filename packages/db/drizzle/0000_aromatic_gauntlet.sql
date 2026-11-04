CREATE TYPE "public"."cycle_status" AS ENUM('draft', 'scheduled', 'open', 'closed', 'reviewing', 'decisions_released', 'archived');--> statement-breakpoint
CREATE TYPE "public"."grant_role" AS ENUM('org_admin', 'committee_director', 'question_editor', 'reviewer');--> statement-breakpoint
CREATE TYPE "public"."grant_scope" AS ENUM('organization', 'team');--> statement-breakpoint
CREATE TYPE "public"."opening_status" AS ENUM('draft', 'open', 'closed');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" text DEFAULT 'user' NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recruitment_cycle" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" "cycle_status" DEFAULT 'draft' NOT NULL,
	"time_zone" text DEFAULT 'America/New_York' NOT NULL,
	"opens_at" timestamp,
	"closes_at" timestamp,
	"max_committees_per_applicant" integer,
	"require_preference_ranking" boolean DEFAULT false NOT NULL,
	"review_opens_at" timestamp,
	"review_closes_at" timestamp,
	"decisions_released_at" timestamp,
	"created_by" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "recruitment_cycle_window_ck" CHECK ("recruitment_cycle"."opens_at" IS NULL OR "recruitment_cycle"."closes_at" IS NULL OR "recruitment_cycle"."closes_at" > "recruitment_cycle"."opens_at"),
	CONSTRAINT "recruitment_cycle_review_window_ck" CHECK ("recruitment_cycle"."review_opens_at" IS NULL OR "recruitment_cycle"."review_closes_at" IS NULL OR "recruitment_cycle"."review_closes_at" > "recruitment_cycle"."review_opens_at"),
	CONSTRAINT "recruitment_cycle_max_committees_ck" CHECK ("recruitment_cycle"."max_committees_per_applicant" IS NULL OR "recruitment_cycle"."max_committees_per_applicant" > 0)
);
--> statement-breakpoint
CREATE TABLE "recruitment_opening" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"status" "opening_status" DEFAULT 'draft' NOT NULL,
	"opens_at" timestamp,
	"closes_at" timestamp,
	"application_limit" integer,
	"capacity" integer,
	"minimum_reviews" integer,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "recruitment_opening_window_ck" CHECK ("recruitment_opening"."opens_at" IS NULL OR "recruitment_opening"."closes_at" IS NULL OR "recruitment_opening"."closes_at" > "recruitment_opening"."opens_at"),
	CONSTRAINT "recruitment_opening_limits_ck" CHECK (("recruitment_opening"."application_limit" IS NULL OR "recruitment_opening"."application_limit" > 0)
          AND ("recruitment_opening"."capacity" IS NULL OR "recruitment_opening"."capacity" > 0)
          AND ("recruitment_opening"."minimum_reviews" IS NULL OR "recruitment_opening"."minimum_reviews" > 0))
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"invited_by" text NOT NULL,
	"team_id" uuid,
	"cycle_id" uuid,
	"token_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"accepted_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation_role" (
	"invitation_id" uuid NOT NULL,
	"role" "grant_role" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permission_grant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"role" "grant_role" NOT NULL,
	"scope" "grant_scope" NOT NULL,
	"team_id" uuid,
	"cycle_id" uuid,
	"granted_by" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"expires_at" timestamp,
	"revoked_at" timestamp,
	CONSTRAINT "permission_grant_scope_team_ck" CHECK (("permission_grant"."scope" = 'organization' AND "permission_grant"."team_id" IS NULL)
          OR ("permission_grant"."scope" = 'team' AND "permission_grant"."team_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "team" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"parent_team_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_cycle" ADD CONSTRAINT "recruitment_cycle_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_opening" ADD CONSTRAINT "recruitment_opening_cycle_id_recruitment_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."recruitment_cycle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_opening" ADD CONSTRAINT "recruitment_opening_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_role" ADD CONSTRAINT "invitation_role_invitation_id_invitation_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_grant" ADD CONSTRAINT "permission_grant_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_grant" ADD CONSTRAINT "permission_grant_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_grant" ADD CONSTRAINT "permission_grant_granted_by_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team" ADD CONSTRAINT "team_parent_team_id_team_id_fk" FOREIGN KEY ("parent_team_id") REFERENCES "public"."team"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "recruitment_cycle_slug_key" ON "recruitment_cycle" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "recruitment_opening_cycle_team_key" ON "recruitment_opening" USING btree ("cycle_id","team_id");--> statement-breakpoint
CREATE INDEX "recruitment_opening_cycleId_idx" ON "recruitment_opening" USING btree ("cycle_id");--> statement-breakpoint
CREATE INDEX "recruitment_opening_teamId_idx" ON "recruitment_opening" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_token_hash_key" ON "invitation" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "invitation_teamId_idx" ON "invitation" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "invitation_cycleId_idx" ON "invitation" USING btree ("cycle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_role_invitation_role_key" ON "invitation_role" USING btree ("invitation_id","role");--> statement-breakpoint
CREATE UNIQUE INDEX "permission_grant_live_team_cycle_key" ON "permission_grant" USING btree ("user_id","role","team_id","cycle_id") WHERE "permission_grant"."revoked_at" IS NULL AND "permission_grant"."team_id" IS NOT NULL AND "permission_grant"."cycle_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "permission_grant_live_team_key" ON "permission_grant" USING btree ("user_id","role","team_id") WHERE "permission_grant"."revoked_at" IS NULL AND "permission_grant"."team_id" IS NOT NULL AND "permission_grant"."cycle_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "permission_grant_live_org_cycle_key" ON "permission_grant" USING btree ("user_id","role","cycle_id") WHERE "permission_grant"."revoked_at" IS NULL AND "permission_grant"."team_id" IS NULL AND "permission_grant"."cycle_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "permission_grant_live_org_key" ON "permission_grant" USING btree ("user_id","role") WHERE "permission_grant"."revoked_at" IS NULL AND "permission_grant"."team_id" IS NULL AND "permission_grant"."cycle_id" IS NULL;--> statement-breakpoint
CREATE INDEX "permission_grant_userId_idx" ON "permission_grant" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "permission_grant_teamId_idx" ON "permission_grant" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "permission_grant_cycleId_idx" ON "permission_grant" USING btree ("cycle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_slug_key" ON "team" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "team_parentTeamId_idx" ON "team" USING btree ("parent_team_id");