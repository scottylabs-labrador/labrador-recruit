-- Team scope, denormalized onto `application` and guaranteed by a composite key.
-- See docs/adr/0006-team-scope-compiles-from-a-denormalized-column.md
--
-- Hand-ordered. `drizzle-kit generate` emitted the composite foreign key
-- *before* the unique constraint it references, which Postgres refuses, and
-- added the column as NOT NULL with no backfill, which fails on any table that
-- already has rows. The applicant surface has shipped, so it does.

--> The parent key the composite foreign key points at. `id` is already the
--> primary key, so this is trivially satisfied; it exists so the pair can be
--> referenced.
ALTER TABLE "recruitment_opening" ADD CONSTRAINT "recruitment_opening_id_team_key" UNIQUE("id","team_id");--> statement-breakpoint

--> Nullable first, so existing rows survive the addition.
ALTER TABLE "application" ADD COLUMN "team_id" uuid;--> statement-breakpoint

--> The column is derived, so the backfill is the definition of it.
UPDATE "application" SET "team_id" = "recruitment_opening"."team_id"
FROM "recruitment_opening"
WHERE "recruitment_opening"."id" = "application"."opening_id";--> statement-breakpoint

--> Only now, with every row populated. An application always belongs to exactly
--> one opening and therefore one team; there is no cycle-wide application.
ALTER TABLE "application" ALTER COLUMN "team_id" SET NOT NULL;--> statement-breakpoint

--> The composite key covers `opening_id` as well, so the single-column
--> reference it replaces is dropped rather than kept alongside.
ALTER TABLE "application" DROP CONSTRAINT "application_opening_id_recruitment_opening_id_fk";--> statement-breakpoint
ALTER TABLE "application" ADD CONSTRAINT "application_opening_team_fk" FOREIGN KEY ("opening_id","team_id") REFERENCES "public"."recruitment_opening"("id","team_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

--> Every authorization predicate on this table filters by it.
CREATE INDEX "application_teamId_idx" ON "application" USING btree ("team_id");
