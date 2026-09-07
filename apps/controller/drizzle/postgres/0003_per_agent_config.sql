-- Hosts are assigned to agents, and each agent can be built with its own module set.
--
-- Both are additive and both default to the old behaviour. A host with no rows in
-- `proxy_host_agents` is served by every agent, which is what the whole fleet did before this
-- table existed, so an existing deployment keeps serving exactly what it served. An agent with a
-- null `buildSettings` follows the fleet-wide selection in `settings`, so enabling a module for
-- everyone still reaches the agents nobody has configured separately.
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "buildSettings" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "proxy_host_agents" (
  "id" serial PRIMARY KEY NOT NULL,
  "proxyHostId" integer NOT NULL REFERENCES "proxy_hosts"("id") ON DELETE cascade,
  "agentId" integer NOT NULL REFERENCES "agents"("id") ON DELETE cascade,
  "createdAt" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "proxy_host_agents_unique" ON "proxy_host_agents" ("proxyHostId","agentId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proxy_host_agents_agent_idx" ON "proxy_host_agents" ("agentId");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "l4_proxy_host_agents" (
  "id" serial PRIMARY KEY NOT NULL,
  "l4ProxyHostId" integer NOT NULL REFERENCES "l4_proxy_hosts"("id") ON DELETE cascade,
  "agentId" integer NOT NULL REFERENCES "agents"("id") ON DELETE cascade,
  "createdAt" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "l4_proxy_host_agents_unique" ON "l4_proxy_host_agents" ("l4ProxyHostId","agentId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "l4_proxy_host_agents_agent_idx" ON "l4_proxy_host_agents" ("agentId");
