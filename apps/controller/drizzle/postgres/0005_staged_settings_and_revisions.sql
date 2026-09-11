-- Settings are staged per operator and applied as one change set, so a reload happens once for a
-- batch rather than once per form.
--
-- Entirely additive. Both tables start empty, and an empty `settings_staged` means every read
-- resolves against `settings` exactly as before - so an upgraded deployment behaves identically
-- until someone edits a setting, and a downgrade loses staged work but no applied configuration.
CREATE TABLE IF NOT EXISTS "settings_staged" (
  "key" text NOT NULL,
  "userId" integer NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "value" text NOT NULL,
  "stagedAt" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "settings_staged_user_key_idx" ON "settings_staged" ("userId","key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "settings_revisions" (
  "id" serial PRIMARY KEY NOT NULL,
  "appliedBy" integer REFERENCES "users"("id") ON DELETE set null,
  "appliedByName" text,
  "summary" text NOT NULL,
  "keys" text NOT NULL,
  "outcome" text NOT NULL,
  "error" text,
  "appliedAt" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "settings_revisions_applied_idx" ON "settings_revisions" ("appliedAt");
