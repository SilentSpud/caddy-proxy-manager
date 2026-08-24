-- better-auth 1.7 scopes account identity by issuer: the account table gains a
-- required `issuer` column, and an identity is keyed by (issuer, accountId)
-- instead of (providerId, accountId).
-- https://better-auth.com/docs/guides/1-7-upgrade-guide#account-identity-is-scoped-by-issuer
--
-- Existing rows are backfilled with exactly the issuer better-auth itself would
-- compute for the same identity, so accounts established before the upgrade keep
-- resolving and users are not silently orphaned from their logins:
--
--   * credential (password) accounts        -> 'local:credential'
--       createLocalAccountIssuer("credential") in @better-auth/core
--   * OIDC providers with a configured issuer -> that issuer, verbatim
--       mapOAuthProvider() passes it through as `accountIssuer`
--   * OAuth2 providers without an issuer    -> 'local:oauth:<providerId>'
--       createOAuthAccountIssuer(providerId) in @better-auth/core
--
-- SQLite cannot add a NOT NULL column to a populated table, so this is the usual
-- rebuild-and-copy rather than an ALTER.
CREATE TABLE accounts_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  accountId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  issuer TEXT NOT NULL,
  accessToken TEXT,
  refreshToken TEXT,
  idToken TEXT,
  accessTokenExpiresAt TEXT,
  refreshTokenExpiresAt TEXT,
  scope TEXT,
  password TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
--> statement-breakpoint
INSERT INTO accounts_new (
  id, userId, accountId, providerId, issuer, accessToken, refreshToken, idToken,
  accessTokenExpiresAt, refreshTokenExpiresAt, scope, password, createdAt, updatedAt
)
SELECT
  a.id,
  a.userId,
  a.accountId,
  a.providerId,
  CASE
    WHEN a.providerId = 'credential' THEN 'local:credential'
    ELSE COALESCE(
      NULLIF((SELECT p.issuer FROM oauth_providers p WHERE p.id = a.providerId), ''),
      'local:oauth:' || a.providerId
    )
  END,
  a.accessToken,
  a.refreshToken,
  a.idToken,
  a.accessTokenExpiresAt,
  a.refreshTokenExpiresAt,
  a.scope,
  a.password,
  a.createdAt,
  a.updatedAt
FROM accounts a;
--> statement-breakpoint
DROP TABLE accounts;
--> statement-breakpoint
ALTER TABLE accounts_new RENAME TO accounts;
--> statement-breakpoint
CREATE UNIQUE INDEX accounts_provider_account_idx ON accounts (providerId, accountId);
--> statement-breakpoint
CREATE UNIQUE INDEX accounts_issuer_account_idx ON accounts (issuer, accountId);
--> statement-breakpoint
CREATE INDEX accounts_user_idx ON accounts (userId);
--> statement-breakpoint
-- Unrelated cleanup, folded into the last pre-release migration rather than
-- given its own: `caddy_config_hash` was written on every applyCaddyConfig()
-- but never read by anything, and the write has been removed. Databases that
-- ran the old code still carry the orphan row; fresh ones never create it, so
-- this is a no-op there.
DELETE FROM settings WHERE key = 'caddy_config_hash';
