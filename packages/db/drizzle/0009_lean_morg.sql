CREATE TYPE "public"."grant_role" AS ENUM('org_admin', 'committee_director', 'question_editor', 'reviewer');--> statement-breakpoint
CREATE TYPE "public"."grant_scope" AS ENUM('organization', 'team');--> statement-breakpoint
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
ALTER TABLE "permission_grant" ADD CONSTRAINT "permission_grant_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_grant" ADD CONSTRAINT "permission_grant_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_grant" ADD CONSTRAINT "permission_grant_granted_by_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team" ADD CONSTRAINT "team_parent_team_id_team_id_fk" FOREIGN KEY ("parent_team_id") REFERENCES "public"."team"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "permission_grant_live_team_cycle_key" ON "permission_grant" USING btree ("user_id","role","team_id","cycle_id") WHERE "permission_grant"."revoked_at" IS NULL AND "permission_grant"."team_id" IS NOT NULL AND "permission_grant"."cycle_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "permission_grant_live_team_key" ON "permission_grant" USING btree ("user_id","role","team_id") WHERE "permission_grant"."revoked_at" IS NULL AND "permission_grant"."team_id" IS NOT NULL AND "permission_grant"."cycle_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "permission_grant_live_org_cycle_key" ON "permission_grant" USING btree ("user_id","role","cycle_id") WHERE "permission_grant"."revoked_at" IS NULL AND "permission_grant"."team_id" IS NULL AND "permission_grant"."cycle_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "permission_grant_live_org_key" ON "permission_grant" USING btree ("user_id","role") WHERE "permission_grant"."revoked_at" IS NULL AND "permission_grant"."team_id" IS NULL AND "permission_grant"."cycle_id" IS NULL;--> statement-breakpoint
CREATE INDEX "permission_grant_userId_idx" ON "permission_grant" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "permission_grant_teamId_idx" ON "permission_grant" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "permission_grant_cycleId_idx" ON "permission_grant" USING btree ("cycle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_slug_key" ON "team" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "team_parentTeamId_idx" ON "team" USING btree ("parent_team_id");