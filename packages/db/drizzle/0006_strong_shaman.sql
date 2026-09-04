CREATE TABLE "applicant_github_profile" (
	"application_id" uuid PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"repos" jsonb,
	"error" text,
	"http_status" integer,
	"fetched_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "applicant_github_profile" ADD CONSTRAINT "applicant_github_profile_application_id_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "applicant_github_profile_fetchedAt_idx" ON "applicant_github_profile" USING btree ("fetched_at");