-- Better Auth 1.7.3+ no longer writes `accounts.issuer` (accounts are keyed by
-- (providerId, accountId) again) and its runtime schema validation fails closed
-- on any NOT NULL column it never writes unless the column is nullable or
-- carries a database default (SCHEMA_MISMATCH on every login, issue #283).
-- CPM still fills `issuer` via the account.create.before hook, so the column
-- gains an empty-string default that the hook always overrides — it exists to
-- satisfy Better Auth's schema check while keeping the NOT NULL bookkeeping
-- invariant. SQLite cannot alter a column default in place, so the table is
-- rebuilt; empty issuers are backfilled the same way migration 0024 did.
CREATE TABLE `accounts_v174` (
  `id` integer PRIMARY KEY AUTOINCREMENT,
  `userId` integer NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `issuer` text NOT NULL DEFAULT '',
  `accountId` text NOT NULL,
  `providerId` text NOT NULL,
  `accessToken` text,
  `refreshToken` text,
  `idToken` text,
  `accessTokenExpiresAt` text,
  `refreshTokenExpiresAt` text,
  `scope` text,
  `password` text,
  `createdAt` text NOT NULL,
  `updatedAt` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `accounts_v174` (
  `id`, `userId`, `issuer`, `accountId`, `providerId`, `accessToken`,
  `refreshToken`, `idToken`, `accessTokenExpiresAt`,
  `refreshTokenExpiresAt`, `scope`, `password`, `createdAt`, `updatedAt`
)
SELECT
  account.`id`,
  account.`userId`,
  CASE
    WHEN TRIM(account.`issuer`) <> '' THEN account.`issuer`
    WHEN account.`providerId` = 'credential' THEN 'local:credential'
    ELSE COALESCE(
      (
        SELECT NULLIF(TRIM(provider.`issuer`), '')
        FROM `oauth_providers` AS provider
        WHERE provider.`id` = account.`providerId`
        LIMIT 1
      ),
      'local:oauth:' || account.`providerId`
    )
  END,
  account.`accountId`,
  account.`providerId`,
  account.`accessToken`,
  account.`refreshToken`,
  account.`idToken`,
  account.`accessTokenExpiresAt`,
  account.`refreshTokenExpiresAt`,
  account.`scope`,
  account.`password`,
  account.`createdAt`,
  account.`updatedAt`
FROM `accounts` AS account;
--> statement-breakpoint
DROP TABLE `accounts`;
--> statement-breakpoint
ALTER TABLE `accounts_v174` RENAME TO `accounts`;
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_issuer_account_idx`
  ON `accounts` (`issuer`, `accountId`);
--> statement-breakpoint
CREATE INDEX `accounts_user_idx` ON `accounts` (`userId`);
