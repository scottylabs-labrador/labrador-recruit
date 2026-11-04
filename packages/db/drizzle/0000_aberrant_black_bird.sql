CREATE TYPE "public"."application_status" AS ENUM('draft', 'submitted', 'under_review', 'shortlisted', 'interview', 'decided', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."assignment_status" AS ENUM('assigned', 'in_progress', 'submitted', 'conflicted', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."cycle_status" AS ENUM('draft', 'scheduled', 'open', 'closed', 'reviewing', 'decisions_released', 'archived');--> statement-breakpoint
CREATE TYPE "public"."file_status" AS ENUM('pending', 'committed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."form_kind" AS ENUM('common', 'committee');--> statement-breakpoint
CREATE TYPE "public"."form_response_status" AS ENUM('draft', 'submitted');--> statement-breakpoint
CREATE TYPE "public"."form_version_status" AS ENUM('draft', 'published', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."grant_role" AS ENUM('org_admin', 'committee_director', 'question_editor', 'reviewer');--> statement-breakpoint
CREATE TYPE "public"."grant_scope" AS ENUM('organization', 'team');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('pending', 'sending', 'sent', 'failed', 'dead');--> statement-breakpoint
CREATE TYPE "public"."opening_status" AS ENUM('draft', 'open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."question_type" AS ENUM('short_text', 'long_text', 'single_select', 'multi_select', 'dropdown', 'number', 'url', 'file_upload', 'section_heading', 'static_content');--> statement-breakpoint
CREATE TYPE "public"."recommendation" AS ENUM('strong_yes', 'yes', 'unsure', 'no', 'strong_no');--> statement-breakpoint
CREATE TYPE "public"."review_confidence" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('draft', 'submitted');--> statement-breakpoint
CREATE TYPE "public"."rubric_status" AS ENUM('draft', 'active', 'locked');--> statement-breakpoint
CREATE TYPE "public"."status_event" AS ENUM('created', 'submitted', 'withdrawn', 'review_started', 'shortlisted', 'interview_invited', 'offered', 'accepted', 'declined', 'confirmed', 'rejected', 'waitlisted');--> statement-breakpoint
CREATE TABLE "answer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_response_id" uuid NOT NULL,
	"form_version_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"value_jsonb" jsonb,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_profile_id" uuid NOT NULL,
	"opening_id" uuid NOT NULL,
	"status" "application_status" DEFAULT 'draft' NOT NULL,
	"preference_rank" integer,
	"submitted_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	"idempotency_key" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "application_preference_rank_ck" CHECK ("application"."preference_rank" IS NULL OR "application"."preference_rank" > 0)
);
--> statement-breakpoint
CREATE TABLE "candidate_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"cycle_id" uuid NOT NULL,
	"common_locked_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_response" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_version_id" uuid NOT NULL,
	"candidate_profile_id" uuid,
	"application_id" uuid,
	"status" "form_response_status" DEFAULT 'draft' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "form_response_id_version_key" UNIQUE("id","form_version_id"),
	CONSTRAINT "form_response_single_owner_ck" CHECK (("form_response"."candidate_profile_id" IS NOT NULL AND "form_response"."application_id" IS NULL)
          OR ("form_response"."candidate_profile_id" IS NULL AND "form_response"."application_id" IS NOT NULL)),
	CONSTRAINT "form_response_submitted_at_ck" CHECK (("form_response"."status" = 'submitted' AND "form_response"."submitted_at" IS NOT NULL)
          OR ("form_response"."status" <> 'submitted' AND "form_response"."submitted_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
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
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recruitment_cycle" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" "cycle_status" DEFAULT 'draft' NOT NULL,
	"time_zone" text DEFAULT 'America/New_York' NOT NULL,
	"opens_at" timestamp with time zone,
	"closes_at" timestamp with time zone,
	"max_committees_per_applicant" integer,
	"require_preference_ranking" boolean DEFAULT false NOT NULL,
	"review_opens_at" timestamp with time zone,
	"review_closes_at" timestamp with time zone,
	"decisions_released_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
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
	"opens_at" timestamp with time zone,
	"closes_at" timestamp with time zone,
	"application_limit" integer,
	"capacity" integer,
	"minimum_reviews" integer,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "recruitment_opening_window_ck" CHECK ("recruitment_opening"."opens_at" IS NULL OR "recruitment_opening"."closes_at" IS NULL OR "recruitment_opening"."closes_at" > "recruitment_opening"."opens_at"),
	CONSTRAINT "recruitment_opening_limits_ck" CHECK (("recruitment_opening"."application_limit" IS NULL OR "recruitment_opening"."application_limit" > 0)
          AND ("recruitment_opening"."capacity" IS NULL OR "recruitment_opening"."capacity" > 0)
          AND ("recruitment_opening"."minimum_reviews" IS NULL OR "recruitment_opening"."minimum_reviews" > 0))
);
--> statement-breakpoint
CREATE TABLE "form" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"team_id" uuid,
	"opening_id" uuid,
	"kind" "form_kind" NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "form_kind_owner_ck" CHECK (("form"."kind" = 'common' AND "form"."team_id" IS NULL AND "form"."opening_id" IS NULL)
          OR ("form"."kind" = 'committee' AND "form"."team_id" IS NOT NULL AND "form"."opening_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "form_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "form_version_status" DEFAULT 'draft' NOT NULL,
	"created_by" text NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "form_version_published_at_ck" CHECK (("form_version"."status" = 'published' AND "form_version"."published_at" IS NOT NULL)
          OR ("form_version"."status" <> 'published' AND "form_version"."published_at" IS NULL)),
	CONSTRAINT "form_version_version_ck" CHECK ("form_version"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "question" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_version_id" uuid NOT NULL,
	"question_key" text NOT NULL,
	"type" "question_type" NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"required" boolean DEFAULT false NOT NULL,
	"position" integer NOT NULL,
	"config_json" jsonb,
	"visibility_rule_json" jsonb,
	CONSTRAINT "question_version_id_key" UNIQUE("form_version_id","id"),
	CONSTRAINT "question_position_ck" CHECK ("question"."position" > 0)
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"invited_by" text NOT NULL,
	"team_id" uuid,
	"cycle_id" uuid,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
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
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
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
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_status_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"old_status" "application_status",
	"new_status" "application_status" NOT NULL,
	"event" "status_event" NOT NULL,
	"changed_by" text,
	"note" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" text,
	"cycle_id" uuid,
	"team_id" uuid,
	"action" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"metadata_json" jsonb,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"application_id" uuid,
	"object_key" text NOT NULL,
	"original_filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"status" "file_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"committed_at" timestamp with time zone,
	CONSTRAINT "file_size_ck" CHECK ("file"."size_bytes" > 0)
);
--> statement-breakpoint
CREATE TABLE "notification_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template" text NOT NULL,
	"recipient_email" text NOT NULL,
	"payload_json" jsonb,
	"status" "notification_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_error" text,
	"available_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "notification_outbox_attempts_ck" CHECK ("notification_outbox"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "review" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"rubric_id" uuid NOT NULL,
	"status" "review_status" DEFAULT 'draft' NOT NULL,
	"recommendation" "recommendation",
	"confidence" "review_confidence",
	"comments" text,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "review_id_rubric_key" UNIQUE("id","rubric_id"),
	CONSTRAINT "review_submitted_at_ck" CHECK (("review"."status" = 'submitted' AND "review"."submitted_at" IS NOT NULL)
          OR ("review"."status" <> 'submitted' AND "review"."submitted_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "review_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"reviewer_id" text NOT NULL,
	"assigned_by" text NOT NULL,
	"status" "assignment_status" DEFAULT 'assigned' NOT NULL,
	"assigned_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "review_score" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"rubric_id" uuid NOT NULL,
	"criterion_id" uuid NOT NULL,
	"score" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rubric" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opening_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "rubric_status" DEFAULT 'draft' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "rubric_version_ck" CHECK ("rubric"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "rubric_criterion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rubric_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"minimum_score" integer NOT NULL,
	"maximum_score" integer NOT NULL,
	"weight" numeric(6, 3) DEFAULT '1' NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "rubric_criterion_rubric_id_key" UNIQUE("rubric_id","id"),
	CONSTRAINT "rubric_criterion_range_ck" CHECK ("rubric_criterion"."maximum_score" > "rubric_criterion"."minimum_score"),
	CONSTRAINT "rubric_criterion_position_ck" CHECK ("rubric_criterion"."position" > 0)
);
--> statement-breakpoint
ALTER TABLE "answer" ADD CONSTRAINT "answer_response_version_fk" FOREIGN KEY ("form_response_id","form_version_id") REFERENCES "public"."form_response"("id","form_version_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer" ADD CONSTRAINT "answer_version_question_fk" FOREIGN KEY ("form_version_id","question_id") REFERENCES "public"."question"("form_version_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application" ADD CONSTRAINT "application_candidate_profile_id_candidate_profile_id_fk" FOREIGN KEY ("candidate_profile_id") REFERENCES "public"."candidate_profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application" ADD CONSTRAINT "application_opening_id_recruitment_opening_id_fk" FOREIGN KEY ("opening_id") REFERENCES "public"."recruitment_opening"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_profile" ADD CONSTRAINT "candidate_profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_profile" ADD CONSTRAINT "candidate_profile_cycle_id_recruitment_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."recruitment_cycle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_response" ADD CONSTRAINT "form_response_form_version_id_form_version_id_fk" FOREIGN KEY ("form_version_id") REFERENCES "public"."form_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_response" ADD CONSTRAINT "form_response_candidate_profile_id_candidate_profile_id_fk" FOREIGN KEY ("candidate_profile_id") REFERENCES "public"."candidate_profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_response" ADD CONSTRAINT "form_response_application_id_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_cycle" ADD CONSTRAINT "recruitment_cycle_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_opening" ADD CONSTRAINT "recruitment_opening_cycle_id_recruitment_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."recruitment_cycle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_opening" ADD CONSTRAINT "recruitment_opening_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form" ADD CONSTRAINT "form_cycle_id_recruitment_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."recruitment_cycle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form" ADD CONSTRAINT "form_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form" ADD CONSTRAINT "form_opening_id_recruitment_opening_id_fk" FOREIGN KEY ("opening_id") REFERENCES "public"."recruitment_opening"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_version" ADD CONSTRAINT "form_version_form_id_form_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."form"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_version" ADD CONSTRAINT "form_version_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_form_version_id_form_version_id_fk" FOREIGN KEY ("form_version_id") REFERENCES "public"."form_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_cycle_id_recruitment_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."recruitment_cycle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_role" ADD CONSTRAINT "invitation_role_invitation_id_invitation_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_grant" ADD CONSTRAINT "permission_grant_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_grant" ADD CONSTRAINT "permission_grant_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_grant" ADD CONSTRAINT "permission_grant_cycle_id_recruitment_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."recruitment_cycle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_grant" ADD CONSTRAINT "permission_grant_granted_by_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team" ADD CONSTRAINT "team_parent_team_id_team_id_fk" FOREIGN KEY ("parent_team_id") REFERENCES "public"."team"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_status_event" ADD CONSTRAINT "application_status_event_application_id_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_status_event" ADD CONSTRAINT "application_status_event_changed_by_user_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file" ADD CONSTRAINT "file_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file" ADD CONSTRAINT "file_application_id_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review" ADD CONSTRAINT "review_assignment_id_review_assignment_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."review_assignment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review" ADD CONSTRAINT "review_rubric_id_rubric_id_fk" FOREIGN KEY ("rubric_id") REFERENCES "public"."rubric"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_assignment" ADD CONSTRAINT "review_assignment_application_id_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_assignment" ADD CONSTRAINT "review_assignment_reviewer_id_user_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_assignment" ADD CONSTRAINT "review_assignment_assigned_by_user_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_score" ADD CONSTRAINT "review_score_review_rubric_fk" FOREIGN KEY ("review_id","rubric_id") REFERENCES "public"."review"("id","rubric_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_score" ADD CONSTRAINT "review_score_rubric_criterion_fk" FOREIGN KEY ("rubric_id","criterion_id") REFERENCES "public"."rubric_criterion"("rubric_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric" ADD CONSTRAINT "rubric_opening_id_recruitment_opening_id_fk" FOREIGN KEY ("opening_id") REFERENCES "public"."recruitment_opening"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric" ADD CONSTRAINT "rubric_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_criterion" ADD CONSTRAINT "rubric_criterion_rubric_id_rubric_id_fk" FOREIGN KEY ("rubric_id") REFERENCES "public"."rubric"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "answer_response_question_key" ON "answer" USING btree ("form_response_id","question_id");--> statement-breakpoint
CREATE INDEX "answer_formResponseId_idx" ON "answer" USING btree ("form_response_id");--> statement-breakpoint
CREATE UNIQUE INDEX "application_profile_opening_key" ON "application" USING btree ("candidate_profile_id","opening_id");--> statement-breakpoint
CREATE UNIQUE INDEX "application_profile_idempotency_key" ON "application" USING btree ("candidate_profile_id","idempotency_key") WHERE "application"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "application_candidateProfileId_idx" ON "application" USING btree ("candidate_profile_id");--> statement-breakpoint
CREATE INDEX "application_openingId_idx" ON "application" USING btree ("opening_id");--> statement-breakpoint
CREATE INDEX "application_status_idx" ON "application" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_profile_user_cycle_key" ON "candidate_profile" USING btree ("user_id","cycle_id");--> statement-breakpoint
CREATE INDEX "candidate_profile_cycleId_idx" ON "candidate_profile" USING btree ("cycle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "form_response_profile_version_key" ON "form_response" USING btree ("candidate_profile_id","form_version_id") WHERE "form_response"."candidate_profile_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "form_response_application_version_key" ON "form_response" USING btree ("application_id","form_version_id") WHERE "form_response"."application_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "form_response_formVersionId_idx" ON "form_response" USING btree ("form_version_id");--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "recruitment_cycle_slug_key" ON "recruitment_cycle" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "recruitment_opening_cycle_team_key" ON "recruitment_opening" USING btree ("cycle_id","team_id");--> statement-breakpoint
CREATE INDEX "recruitment_opening_cycleId_idx" ON "recruitment_opening" USING btree ("cycle_id");--> statement-breakpoint
CREATE INDEX "recruitment_opening_teamId_idx" ON "recruitment_opening" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "form_common_per_cycle_key" ON "form" USING btree ("cycle_id") WHERE "form"."kind" = 'common';--> statement-breakpoint
CREATE UNIQUE INDEX "form_committee_per_opening_key" ON "form" USING btree ("opening_id") WHERE "form"."kind" = 'committee';--> statement-breakpoint
CREATE INDEX "form_cycleId_idx" ON "form" USING btree ("cycle_id");--> statement-breakpoint
CREATE INDEX "form_openingId_idx" ON "form" USING btree ("opening_id");--> statement-breakpoint
CREATE UNIQUE INDEX "form_version_form_version_key" ON "form_version" USING btree ("form_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "form_version_one_draft_key" ON "form_version" USING btree ("form_id") WHERE "form_version"."status" = 'draft';--> statement-breakpoint
CREATE INDEX "form_version_formId_idx" ON "form_version" USING btree ("form_id");--> statement-breakpoint
CREATE UNIQUE INDEX "question_version_key_key" ON "question" USING btree ("form_version_id","question_key");--> statement-breakpoint
CREATE UNIQUE INDEX "question_version_position_key" ON "question" USING btree ("form_version_id","position");--> statement-breakpoint
CREATE INDEX "question_formVersionId_idx" ON "question" USING btree ("form_version_id");--> statement-breakpoint
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
CREATE INDEX "team_parentTeamId_idx" ON "team" USING btree ("parent_team_id");--> statement-breakpoint
CREATE INDEX "application_status_event_applicationId_idx" ON "application_status_event" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "application_status_event_createdAt_idx" ON "application_status_event" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_event_cycleId_idx" ON "audit_event" USING btree ("cycle_id");--> statement-breakpoint
CREATE INDEX "audit_event_teamId_idx" ON "audit_event" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "audit_event_action_idx" ON "audit_event" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_event_createdAt_idx" ON "audit_event" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "file_object_key_key" ON "file" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "file_ownerUserId_idx" ON "file" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "file_applicationId_idx" ON "file" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "notification_outbox_claim_idx" ON "notification_outbox" USING btree ("status","available_at");--> statement-breakpoint
CREATE UNIQUE INDEX "review_assignment_key" ON "review" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "review_rubricId_idx" ON "review" USING btree ("rubric_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_assignment_live_key" ON "review_assignment" USING btree ("application_id","reviewer_id") WHERE "review_assignment"."status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "review_assignment_applicationId_idx" ON "review_assignment" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "review_assignment_reviewerId_idx" ON "review_assignment" USING btree ("reviewer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_score_review_criterion_key" ON "review_score" USING btree ("review_id","criterion_id");--> statement-breakpoint
CREATE INDEX "review_score_reviewId_idx" ON "review_score" USING btree ("review_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rubric_opening_version_key" ON "rubric" USING btree ("opening_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "rubric_one_active_key" ON "rubric" USING btree ("opening_id") WHERE "rubric"."status" = 'active';--> statement-breakpoint
CREATE INDEX "rubric_openingId_idx" ON "rubric" USING btree ("opening_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rubric_criterion_rubric_name_key" ON "rubric_criterion" USING btree ("rubric_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "rubric_criterion_rubric_position_key" ON "rubric_criterion" USING btree ("rubric_id","position");