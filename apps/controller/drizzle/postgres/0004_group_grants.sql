-- Groups can be mapped from an IdP by name, and granted management of specific hosts and agents.
--
-- Entirely additive. Both tables start empty, and a grant only widens what the new `operator` role
-- can reach - an admin, user or viewer is unaffected by every row in here, so no existing user's
-- access changes on upgrade. Nobody becomes an operator until someone sets that role by hand.
ALTER TABLE "oauth_providers" ADD COLUMN IF NOT EXISTS "operatorGroup" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "group_idp_mappings" (
  "id" serial PRIMARY KEY NOT NULL,
  "groupId" integer NOT NULL REFERENCES "groups"("id") ON DELETE cascade,
  "providerId" text REFERENCES "oauth_providers"("id") ON DELETE cascade,
  "externalName" text NOT NULL,
  "externalKey" text NOT NULL,
  "createdAt" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "group_idp_mappings_group_idx" ON "group_idp_mappings" ("groupId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "group_idp_mappings_key_idx" ON "group_idp_mappings" ("externalKey");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "group_grants" (
  "id" serial PRIMARY KEY NOT NULL,
  "groupId" integer NOT NULL REFERENCES "groups"("id") ON DELETE cascade,
  "proxyHostId" integer REFERENCES "proxy_hosts"("id") ON DELETE cascade,
  "l4ProxyHostId" integer REFERENCES "l4_proxy_hosts"("id") ON DELETE cascade,
  "agentId" integer REFERENCES "agents"("id") ON DELETE cascade,
  "capability" text DEFAULT 'manage' NOT NULL,
  "createdAt" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "group_grants_group_idx" ON "group_grants" ("groupId");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "group_grants_proxy_host_unique" ON "group_grants" ("groupId","proxyHostId");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "group_grants_l4_host_unique" ON "group_grants" ("groupId","l4ProxyHostId");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "group_grants_agent_unique" ON "group_grants" ("groupId","agentId");
