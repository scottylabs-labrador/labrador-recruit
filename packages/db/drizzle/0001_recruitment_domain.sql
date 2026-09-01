CREATE TYPE "public"."answer_type" AS ENUM('short_text', 'long_text', 'url', 'choice', 'multi_choice', 'rank', 'boolean');--> statement-breakpoint
CREATE TYPE "public"."applicant_year" AS ENUM('first_year', 'sophomore', 'junior', 'senior', 'grad', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."assignment_status" AS ENUM('assigned', 'in_progress', 'submitted', 'conflicted', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."candidacy_source" AS ENUM('top_preference', 'committee_question_opt_in', 'manual');--> statement-breakpoint
CREATE TYPE "public"."candidacy_status" AS ENUM('pending_assignment', 'in_review', 'needs_additional_review', 'ready_for_decision', 'decided');--> statement-breakpoint
CREATE TYPE "public"."criterion_source" AS ENUM('reviewer', 'application_preference');--> statement-breakpoint
CREATE TYPE "public"."cycle_status" AS ENUM('draft', 'open', 'reviewing', 'deciding', 'archived');--> statement-breakpoint
CREATE TYPE "public"."decision_status" AS ENUM('pending', 'discuss', 'accept', 'waitlist', 'reject', 'redirect');--> statement-breakpoint
CREATE TYPE "public"."import_row_status" AS ENUM('pending', 'imported', 'updated', 'skipped', 'error');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('pending', 'previewed', 'committed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."placement_status" AS ENUM('pending', 'placed', 'waitlisted', 'rejected', 'declined');--> statement-breakpoint
CREATE TYPE "public"."recommendation" AS ENUM('strong_yes', 'yes', 'unsure', 'no', 'strong_no');--> statement-breakpoint
CREATE TYPE "public"."recruitment_role" AS ENUM('reviewer', 'committee_lead', 'recruitment_admin');--> statement-breakpoint
CREATE TYPE "public"."review_confidence" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TABLE "applicant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"raw_email" text NOT NULL,
	"full_name" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"applicant_id" uuid NOT NULL,
	"submitted_at" timestamp,
	"major" text,
	"year" "applicant_year" DEFAULT 'unknown' NOT NULL,
	"raw_year" text,
	"ranking_explanation" text,
	"friend_request" text,
	"heard_about_scottylabs" text,
	"raw_response" jsonb NOT NULL,
	"source_import_id" uuid,
	"source_row_number" integer,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_answer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"question_definition_id" uuid NOT NULL,
	"answer_text" text,
	"answer_json" jsonb,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "committee_candidacy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"committee_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"source" "candidacy_source" NOT NULL,
	"status" "candidacy_status" DEFAULT 'pending_assignment' NOT NULL,
	"disagreement_reason" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "committee_preference" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"committee_id" uuid NOT NULL,
	"rank" integer NOT NULL,
	"raw_rank_label" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_definition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"external_header" text NOT NULL,
	"key" text NOT NULL,
	"section" text DEFAULT 'general' NOT NULL,
	"committee_id" uuid,
	"question_text" text NOT NULL,
	"answer_type" "answer_type" DEFAULT 'long_text' NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_sensitive" boolean DEFAULT false NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid,
	"actor_user_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"metadata" jsonb,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "committee_decision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidacy_id" uuid NOT NULL,
	"status" "decision_status" DEFAULT 'pending' NOT NULL,
	"notes" text,
	"redirect_committee_id" uuid,
	"decided_by" text,
	"decided_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "final_placement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"committee_id" uuid,
	"status" "placement_status" DEFAULT 'pending' NOT NULL,
	"notes" text,
	"decided_by" text,
	"decided_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"status" "import_status" DEFAULT 'pending' NOT NULL,
	"header_mapping" jsonb,
	"row_count" integer DEFAULT 0 NOT NULL,
	"success_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"committed_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_row" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"source_row_number" integer NOT NULL,
	"raw_json" jsonb NOT NULL,
	"row_hash" text NOT NULL,
	"status" "import_row_status" DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"application_id" uuid,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "committee" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cycle_committee" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"committee_id" uuid NOT NULL,
	"capacity" integer,
	"minimum_reviews" integer,
	"settings" jsonb,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recruitment_cycle" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"status" "cycle_status" DEFAULT 'draft' NOT NULL,
	"opens_at" timestamp,
	"closes_at" timestamp,
	"minimum_reviews" integer DEFAULT 3 NOT NULL,
	"blind_review_enabled" boolean DEFAULT false NOT NULL,
	"candidacy_top_n" integer DEFAULT 3 NOT NULL,
	"candidacy_include_opt_ins" boolean DEFAULT true NOT NULL,
	"disagreement_spread_threshold" integer DEFAULT 20 NOT NULL,
	"disagreement_on_extreme_conflict" boolean DEFAULT true NOT NULL,
	"preference_score_map" jsonb NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recruitment_membership" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "recruitment_role" NOT NULL,
	"committee_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"rubric_id" uuid NOT NULL,
	"recommendation" "recommendation",
	"confidence" "review_confidence",
	"rationale" text,
	"private_notes" text,
	"discussion_flag" boolean DEFAULT false NOT NULL,
	"underrated_flag" boolean DEFAULT false NOT NULL,
	"computed_score" numeric(6, 2),
	"submitted_at" timestamp,
	"reopened_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidacy_id" uuid NOT NULL,
	"reviewer_user_id" text NOT NULL,
	"status" "assignment_status" DEFAULT 'assigned' NOT NULL,
	"assigned_at" timestamp NOT NULL,
	"submitted_at" timestamp,
	"conflicted_at" timestamp,
	"created_by" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_score" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"criterion_id" uuid NOT NULL,
	"score" integer NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rubric" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"committee_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rubric_criterion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rubric_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"weight" numeric(6, 4) NOT NULL,
	"min_score" integer DEFAULT 1 NOT NULL,
	"max_score" integer DEFAULT 5 NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"source" "criterion_source" DEFAULT 'reviewer' NOT NULL,
	"anchors" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "application" ADD CONSTRAINT "application_cycle_id_recruitment_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."recruitment_cycle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application" ADD CONSTRAINT "application_applicant_id_applicant_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_answer" ADD CONSTRAINT "application_answer_application_id_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_answer" ADD CONSTRAINT "application_answer_question_definition_id_question_definition_id_fk" FOREIGN KEY ("question_definition_id") REFERENCES "public"."question_definition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_candidacy" ADD CONSTRAINT "committee_candidacy_application_id_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_candidacy" ADD CONSTRAINT "committee_candidacy_committee_id_committee_id_fk" FOREIGN KEY ("committee_id") REFERENCES "public"."committee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_preference" ADD CONSTRAINT "committee_preference_application_id_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_preference" ADD CONSTRAINT "committee_preference_committee_id_committee_id_fk" FOREIGN KEY ("committee_id") REFERENCES "public"."committee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_definition" ADD CONSTRAINT "question_definition_cycle_id_recruitment_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."recruitment_cycle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_definition" ADD CONSTRAINT "question_definition_committee_id_committee_id_fk" FOREIGN KEY ("committee_id") REFERENCES "public"."committee"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_cycle_id_recruitment_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."recruitment_cycle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_decision" ADD CONSTRAINT "committee_decision_candidacy_id_committee_candidacy_id_fk" FOREIGN KEY ("candidacy_id") REFERENCES "public"."committee_candidacy"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_decision" ADD CONSTRAINT "committee_decision_redirect_committee_id_committee_id_fk" FOREIGN KEY ("redirect_committee_id") REFERENCES "public"."committee"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_decision" ADD CONSTRAINT "committee_decision_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "final_placement" ADD CONSTRAINT "final_placement_application_id_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "final_placement" ADD CONSTRAINT "final_placement_committee_id_committee_id_fk" FOREIGN KEY ("committee_id") REFERENCES "public"."committee"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "final_placement" ADD CONSTRAINT "final_placement_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_cycle_id_recruitment_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."recruitment_cycle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_row" ADD CONSTRAINT "import_row_import_id_import_batch_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."import_batch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_row" ADD CONSTRAINT "import_row_application_id_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_committee" ADD CONSTRAINT "cycle_committee_cycle_id_recruitment_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."recruitment_cycle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_committee" ADD CONSTRAINT "cycle_committee_committee_id_committee_id_fk" FOREIGN KEY ("committee_id") REFERENCES "public"."committee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_membership" ADD CONSTRAINT "recruitment_membership_cycle_id_recruitment_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."recruitment_cycle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_membership" ADD CONSTRAINT "recruitment_membership_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_membership" ADD CONSTRAINT "recruitment_membership_committee_id_committee_id_fk" FOREIGN KEY ("committee_id") REFERENCES "public"."committee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review" ADD CONSTRAINT "review_assignment_id_review_assignment_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."review_assignment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review" ADD CONSTRAINT "review_rubric_id_rubric_id_fk" FOREIGN KEY ("rubric_id") REFERENCES "public"."rubric"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_assignment" ADD CONSTRAINT "review_assignment_candidacy_id_committee_candidacy_id_fk" FOREIGN KEY ("candidacy_id") REFERENCES "public"."committee_candidacy"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_assignment" ADD CONSTRAINT "review_assignment_reviewer_user_id_user_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_assignment" ADD CONSTRAINT "review_assignment_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_score" ADD CONSTRAINT "review_score_review_id_review_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."review"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_score" ADD CONSTRAINT "review_score_criterion_id_rubric_criterion_id_fk" FOREIGN KEY ("criterion_id") REFERENCES "public"."rubric_criterion"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric" ADD CONSTRAINT "rubric_cycle_id_recruitment_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."recruitment_cycle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric" ADD CONSTRAINT "rubric_committee_id_committee_id_fk" FOREIGN KEY ("committee_id") REFERENCES "public"."committee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_criterion" ADD CONSTRAINT "rubric_criterion_rubric_id_rubric_id_fk" FOREIGN KEY ("rubric_id") REFERENCES "public"."rubric"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "applicant_email_key" ON "applicant" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "application_cycle_applicant_key" ON "application" USING btree ("cycle_id","applicant_id");--> statement-breakpoint
CREATE INDEX "application_cycleId_idx" ON "application" USING btree ("cycle_id");--> statement-breakpoint
CREATE INDEX "application_applicantId_idx" ON "application" USING btree ("applicant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "application_answer_application_question_key" ON "application_answer" USING btree ("application_id","question_definition_id");--> statement-breakpoint
CREATE INDEX "application_answer_applicationId_idx" ON "application_answer" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "application_answer_questionDefinitionId_idx" ON "application_answer" USING btree ("question_definition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "committee_candidacy_application_committee_key" ON "committee_candidacy" USING btree ("application_id","committee_id");--> statement-breakpoint
CREATE INDEX "committee_candidacy_applicationId_idx" ON "committee_candidacy" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "committee_candidacy_committeeId_idx" ON "committee_candidacy" USING btree ("committee_id");--> statement-breakpoint
CREATE INDEX "committee_candidacy_status_idx" ON "committee_candidacy" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "committee_preference_application_committee_key" ON "committee_preference" USING btree ("application_id","committee_id");--> statement-breakpoint
CREATE INDEX "committee_preference_applicationId_idx" ON "committee_preference" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "committee_preference_committeeId_idx" ON "committee_preference" USING btree ("committee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "question_definition_cycle_key_key" ON "question_definition" USING btree ("cycle_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "question_definition_cycle_header_key" ON "question_definition" USING btree ("cycle_id","external_header");--> statement-breakpoint
CREATE INDEX "question_definition_cycleId_idx" ON "question_definition" USING btree ("cycle_id");--> statement-breakpoint
CREATE INDEX "question_definition_committeeId_idx" ON "question_definition" USING btree ("committee_id");--> statement-breakpoint
CREATE INDEX "audit_event_cycleId_idx" ON "audit_event" USING btree ("cycle_id");--> statement-breakpoint
CREATE INDEX "audit_event_actorUserId_idx" ON "audit_event" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "audit_event_entity_idx" ON "audit_event" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_event_createdAt_idx" ON "audit_event" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "committee_decision_candidacy_key" ON "committee_decision" USING btree ("candidacy_id");--> statement-breakpoint
CREATE INDEX "committee_decision_status_idx" ON "committee_decision" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "final_placement_application_key" ON "final_placement" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "final_placement_committeeId_idx" ON "final_placement" USING btree ("committee_id");--> statement-breakpoint
CREATE INDEX "final_placement_status_idx" ON "final_placement" USING btree ("status");--> statement-breakpoint
CREATE INDEX "import_batch_cycleId_idx" ON "import_batch" USING btree ("cycle_id");--> statement-breakpoint
CREATE INDEX "import_batch_status_idx" ON "import_batch" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "import_row_import_rownum_key" ON "import_row" USING btree ("import_id","source_row_number");--> statement-breakpoint
CREATE INDEX "import_row_importId_idx" ON "import_row" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX "import_row_applicationId_idx" ON "import_row" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "import_row_status_idx" ON "import_row" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "committee_slug_key" ON "committee" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "cycle_committee_cycle_committee_key" ON "cycle_committee" USING btree ("cycle_id","committee_id");--> statement-breakpoint
CREATE INDEX "cycle_committee_cycleId_idx" ON "cycle_committee" USING btree ("cycle_id");--> statement-breakpoint
CREATE INDEX "cycle_committee_committeeId_idx" ON "cycle_committee" USING btree ("committee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recruitment_cycle_slug_key" ON "recruitment_cycle" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "recruitment_membership_scoped_key" ON "recruitment_membership" USING btree ("cycle_id","user_id","role","committee_id") WHERE "recruitment_membership"."committee_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "recruitment_membership_cycle_wide_key" ON "recruitment_membership" USING btree ("cycle_id","user_id","role") WHERE "recruitment_membership"."committee_id" IS NULL;--> statement-breakpoint
CREATE INDEX "recruitment_membership_cycleId_idx" ON "recruitment_membership" USING btree ("cycle_id");--> statement-breakpoint
CREATE INDEX "recruitment_membership_userId_idx" ON "recruitment_membership" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "recruitment_membership_committeeId_idx" ON "recruitment_membership" USING btree ("committee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_assignment_key" ON "review" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "review_rubricId_idx" ON "review" USING btree ("rubric_id");--> statement-breakpoint
CREATE INDEX "review_submittedAt_idx" ON "review" USING btree ("submitted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "review_assignment_candidacy_reviewer_key" ON "review_assignment" USING btree ("candidacy_id","reviewer_user_id");--> statement-breakpoint
CREATE INDEX "review_assignment_candidacyId_idx" ON "review_assignment" USING btree ("candidacy_id");--> statement-breakpoint
CREATE INDEX "review_assignment_reviewerUserId_idx" ON "review_assignment" USING btree ("reviewer_user_id");--> statement-breakpoint
CREATE INDEX "review_assignment_status_idx" ON "review_assignment" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "review_score_review_criterion_key" ON "review_score" USING btree ("review_id","criterion_id");--> statement-breakpoint
CREATE INDEX "review_score_reviewId_idx" ON "review_score" USING btree ("review_id");--> statement-breakpoint
CREATE INDEX "review_score_criterionId_idx" ON "review_score" USING btree ("criterion_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rubric_scope_version_key" ON "rubric" USING btree ("cycle_id","committee_id","version");--> statement-breakpoint
CREATE INDEX "rubric_cycleId_idx" ON "rubric" USING btree ("cycle_id");--> statement-breakpoint
CREATE INDEX "rubric_committeeId_idx" ON "rubric" USING btree ("committee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rubric_criterion_rubric_key_key" ON "rubric_criterion" USING btree ("rubric_id","key");--> statement-breakpoint
CREATE INDEX "rubric_criterion_rubricId_idx" ON "rubric_criterion" USING btree ("rubric_id");