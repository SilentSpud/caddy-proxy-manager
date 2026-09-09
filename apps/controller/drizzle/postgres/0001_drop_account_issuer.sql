-- better-auth 1.7.3 withdraws the account `issuer` column that 1.7.0 introduced.
-- Accounts are once again recognised by (providerId, accountId), as they were in 1.6.
-- https://www.better-auth.com/docs/guides/1-7-upgrade-guide
--
-- Only databases that ran 1.7.0 through 1.7.2 carry the column, but leaving it in place
-- is not an option: it is NOT NULL and 1.7.3 never writes it, so every insert into
-- `accounts` would fail. Nothing is lost by dropping it - the issuer was derived from
-- `providerId` and `oauth_providers.issuer`, both of which remain.
--
-- The index goes before the column, as the upgrade guide requires.
DROP INDEX IF EXISTS "accounts_issuer_account_idx";--> statement-breakpoint
ALTER TABLE "accounts" DROP COLUMN IF EXISTS "issuer";
