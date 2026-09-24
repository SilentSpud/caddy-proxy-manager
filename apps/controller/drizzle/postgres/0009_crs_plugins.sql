-- CRS plugins installed from the plugin registry. Additive: the WAF settings and each host select
-- them by id from their existing JSON, as they do presets.
CREATE TABLE IF NOT EXISTS "crs_plugins" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "repository" text NOT NULL,
  "version" text NOT NULL,
  "description" text,
  "ruleIdStart" integer NOT NULL,
  "ruleIdEnd" integer NOT NULL,
  "configRules" text NOT NULL,
  "beforeRules" text NOT NULL,
  "afterRules" text NOT NULL,
  "configOverride" text,
  "createdBy" integer REFERENCES "users"("id") ON DELETE set null,
  "createdAt" text NOT NULL,
  "updatedAt" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "crs_plugins_name_unique" ON "crs_plugins" ("name");
