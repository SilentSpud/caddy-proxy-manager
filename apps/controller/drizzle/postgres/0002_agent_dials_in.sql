-- Agents connect to the controller now, not the other way round.
--
-- `address` was how the controller dialled an agent. Nothing dials any more: the agent opens an
-- event stream to the controller and holds it open, so reachability is a property of the live
-- connection registry rather than a column. Dropping it rather than leaving it nullable, because a
-- stale address that nothing reads is exactly the sort of row an operator later trusts.
--
-- Every existing row is deleted. This is not data loss that can be avoided: those rows hold secrets
-- agreed under the old handshake, where the controller proved itself to the agent. Under the new
-- one the agent proves itself to the controller with a secret the controller minted, so an old
-- secret cannot be carried forward - every agent has to be paired again with a fresh code.
DELETE FROM "agents";

DROP INDEX IF EXISTS "agents_address_unique";
--> statement-breakpoint
ALTER TABLE "agents" DROP COLUMN IF EXISTS "address";
--> statement-breakpoint
ALTER TABLE "agents" ALTER COLUMN "agentId" SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "agents_agentId_unique" ON "agents" ("agentId");
