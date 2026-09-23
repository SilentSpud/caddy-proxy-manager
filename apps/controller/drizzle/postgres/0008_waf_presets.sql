-- Named WAF rule presets (upstream #149). Entirely additive: the table starts empty, and the
-- global WAF setting and each host reference presets by id from their existing JSON.
CREATE TABLE IF NOT EXISTS "waf_presets" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "directives" text NOT NULL,
  "createdBy" integer REFERENCES "users"("id") ON DELETE set null,
  "createdAt" text NOT NULL,
  "updatedAt" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "waf_presets_name_unique" ON "waf_presets" ("name");
