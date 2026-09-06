// The application's tables. Hand-edited: this was generated from a SQLite schema until that
// backend was removed, and it is now the single source of truth. After editing, regenerate the
// migrations with `DATABASE_URL=postgres://... bun run db:generate`.
import {
  boolean,
  index,
  integer,
  pgTable,
  serial,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { isoTimestamp } from "./columns.pg";

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name"),
    passwordHash: text("passwordHash"),
    role: text("role").notNull().default("user"),
    provider: text("provider"),
    subject: text("subject"),
    avatarUrl: text("avatarUrl"),
    status: text("status").notNull().default("active"),
    username: text("username"),
    displayUsername: text("displayUsername"),
    emailVerified: boolean("emailVerified").notNull().default(false),
    createdAt: isoTimestamp("createdAt").notNull(),
    updatedAt: isoTimestamp("updatedAt").notNull(),
  },
  (table) => ({
    emailUnique: uniqueIndex("users_email_unique").on(table.email),
  }),
);

// Auth tables use camelCase DB columns to match Better Auth's Kysely adapter.
export const sessions = pgTable(
  "sessions",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    token: text("token").notNull(),
    expiresAt: isoTimestamp("expiresAt").notNull(),
    ipAddress: text("ipAddress"),
    userAgent: text("userAgent"),
    // Which IdP session this one came from, when it came from one at all. OIDC back-channel
    // logout names the session to end by its `sid`, which is only unique within an issuer — so
    // the provider is stored beside it rather than matching on `sid` alone. Both stay null for
    // credential sign-ins and for providers that issue no `sid`.
    oidcProviderId: text("oidcProviderId"),
    oidcSid: text("oidcSid"),
    createdAt: isoTimestamp("createdAt").notNull(),
    updatedAt: isoTimestamp("updatedAt").notNull(),
  },
  (table) => ({
    tokenUnique: uniqueIndex("sessions_token_unique").on(table.token),
    userIdx: index("sessions_user_idx").on(table.userId),
    oidcSessionIdx: index("sessions_oidc_session_idx").on(table.oidcProviderId, table.oidcSid),
  }),
);

export const accounts = pgTable(
  "accounts",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    accountId: text("accountId").notNull(),
    providerId: text("providerId").notNull(),
    // better-auth 1.7 scopes account identity by issuer, not providerId: `local:credential` for
    // passwords, the provider's issuer URL for OIDC, `local:oauth:<id>` otherwise. Set on write;
    // migration 0024 backfilled existing rows.
    issuer: text("issuer").notNull(),
    accessToken: text("accessToken"),
    refreshToken: text("refreshToken"),
    idToken: text("idToken"),
    accessTokenExpiresAt: isoTimestamp("accessTokenExpiresAt"),
    refreshTokenExpiresAt: isoTimestamp("refreshTokenExpiresAt"),
    scope: text("scope"),
    password: text("password"),
    createdAt: isoTimestamp("createdAt").notNull(),
    updatedAt: isoTimestamp("updatedAt").notNull(),
  },
  (table) => ({
    providerAccountIdx: uniqueIndex("accounts_provider_account_idx").on(
      table.providerId,
      table.accountId,
    ),
    issuerAccountIdx: uniqueIndex("accounts_issuer_account_idx").on(table.issuer, table.accountId),
    userIdx: index("accounts_user_idx").on(table.userId),
  }),
);

export const verifications = pgTable("verifications", {
  id: serial("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: isoTimestamp("expiresAt").notNull(),
  createdAt: isoTimestamp("createdAt"),
  updatedAt: isoTimestamp("updatedAt"),
});

export const oauthProviders = pgTable(
  "oauth_providers",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    type: text("type").notNull().default("oidc"),
    clientId: text("clientId").notNull(),
    clientSecret: text("clientSecret").notNull(),
    issuer: text("issuer"),
    authorizationUrl: text("authorizationUrl"),
    tokenUrl: text("tokenUrl"),
    userinfoUrl: text("userinfoUrl"),
    scopes: text("scopes").notNull().default("openid email profile"),
    autoLink: boolean("autoLink").notNull().default(false),
    enabled: boolean("enabled").notNull().default(true),
    source: text("source").notNull().default("ui"),
    // ── OIDC group mapping ────────────────────────────────────────────────
    // Claim holding the user's groups. Dot-separated paths address nested claims (e.g.
    // "resource_access.cpm.roles").
    groupsClaim: text("groupsClaim").notNull().default("groups"),
    // Convention prefix: with "CPM_", membership of "CPM_Admin" grants admin.
    groupPrefix: text("groupPrefix"),
    roleMappingEnabled: boolean("roleMappingEnabled").notNull().default(false),
    // Explicit overrides; when unset they are derived from groupPrefix.
    adminGroup: text("adminGroup"),
    userGroup: text("userGroup"),
    viewerGroup: text("viewerGroup"),
    // Role assigned when no role group matched.
    defaultRole: text("defaultRole").notNull().default("user"),
    // Mirror the remaining prefixed IdP groups into CPM groups.
    syncGroups: boolean("syncGroups").notNull().default(false),
    createdAt: text("createdAt").notNull(),
    updatedAt: text("updatedAt").notNull(),
  },
  (table) => ({
    nameUnique: uniqueIndex("oauth_providers_name_unique").on(table.name),
  }),
);

export const oauthStates = pgTable(
  "oauth_states",
  {
    id: serial("id").primaryKey(),
    state: text("state").notNull(),
    codeVerifier: text("codeVerifier").notNull(),
    redirectTo: text("redirectTo"),
    createdAt: text("createdAt").notNull(),
    expiresAt: text("expiresAt").notNull(),
  },
  (table) => ({
    stateUnique: uniqueIndex("oauth_state_unique").on(table.state),
  }),
);

export const pendingOAuthLinks = pgTable(
  "pending_oauth_links",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 50 }).notNull(),
    userEmail: text("userEmail").notNull(), // Email of the user who initiated linking
    createdAt: text("createdAt").notNull(),
    expiresAt: text("expiresAt").notNull(),
  },
  (table) => ({
    // Ensure only one pending link per user per provider (prevents race conditions)
    userProviderUnique: uniqueIndex("pending_oauth_user_provider_unique").on(
      table.userId,
      table.provider,
    ),
  }),
);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updatedAt").notNull(),
});

/**
 * Agents this controller has paired with.
 *
 * The local agent is not in here: it is found by its socket on the shared volume and proves itself
 * with a secret it rotates on every start, so a stored row would go stale on every restart. This
 * table is for agents reached over the network, whose secret was agreed once during pairing and is
 * the only way back to them.
 */
export const agents = pgTable(
  "agents",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    /** Origin the agent listens on, e.g. `https://agent.example.com:3100`. No trailing slash. */
    address: text("address").notNull(),
    /** The agent's own stable id, as it reported at pairing. Detects a replaced host. */
    agentId: text("agentId"),
    /** Shared secret, encrypted at rest. Never leaves the server. */
    secret: text("secret").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    lastSeenAt: text("lastSeenAt"),
    lastError: text("lastError"),
    createdAt: text("createdAt").notNull(),
    updatedAt: text("updatedAt").notNull(),
  },
  (table) => ({
    addressUnique: uniqueIndex("agents_address_unique").on(table.address),
  }),
);

export const accessLists = pgTable("access_lists", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  createdBy: integer("createdBy").references(() => users.id, { onDelete: "set null" }),
  createdAt: text("createdAt").notNull(),
  updatedAt: text("updatedAt").notNull(),
});

export const accessListEntries = pgTable(
  "access_list_entries",
  {
    id: serial("id").primaryKey(),
    accessListId: integer("accessListId")
      .references(() => accessLists.id, { onDelete: "cascade" })
      .notNull(),
    username: text("username").notNull(),
    passwordHash: text("passwordHash").notNull(),
    createdAt: text("createdAt").notNull(),
    updatedAt: text("updatedAt").notNull(),
  },
  (table) => ({
    accessListIdIdx: index("access_list_entries_list_idx").on(table.accessListId),
  }),
);

export const certificates = pgTable("certificates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  domainNames: text("domainNames").notNull(),
  autoRenew: boolean("autoRenew").notNull().default(true),
  providerOptions: text("providerOptions"),
  certificatePem: text("certificatePem"),
  privateKeyPem: text("privateKeyPem"),
  createdBy: integer("createdBy").references(() => users.id, { onDelete: "set null" }),
  createdAt: text("createdAt").notNull(),
  updatedAt: text("updatedAt").notNull(),
});

export const caCertificates = pgTable("ca_certificates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  certificatePem: text("certificatePem").notNull(),
  privateKeyPem: text("privateKeyPem"),
  createdBy: integer("createdBy").references(() => users.id, { onDelete: "set null" }),
  createdAt: text("createdAt").notNull(),
  updatedAt: text("updatedAt").notNull(),
});

export const issuedClientCertificates = pgTable(
  "issued_client_certificates",
  {
    id: serial("id").primaryKey(),
    caCertificateId: integer("caCertificateId")
      .references(() => caCertificates.id, { onDelete: "cascade" })
      .notNull(),
    commonName: text("commonName").notNull(),
    serialNumber: text("serialNumber").notNull(),
    fingerprintSha256: text("fingerprintSha256").notNull(),
    certificatePem: text("certificatePem").notNull(),
    validFrom: text("validFrom").notNull(),
    validTo: text("validTo").notNull(),
    revokedAt: text("revokedAt"),
    createdBy: integer("createdBy").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("createdAt").notNull(),
    updatedAt: text("updatedAt").notNull(),
  },
  (table) => ({
    caCertificateIdx: index("issued_client_certificates_ca_idx").on(table.caCertificateId),
    revokedAtIdx: index("issued_client_certificates_revoked_at_idx").on(table.revokedAt),
  }),
);

export const proxyHosts = pgTable("proxy_hosts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  domains: text("domains").notNull(),
  upstreams: text("upstreams").notNull(),
  certificateId: integer("certificateId").references(() => certificates.id, {
    onDelete: "set null",
  }),
  accessListId: integer("accessListId").references(() => accessLists.id, { onDelete: "set null" }),
  ownerUserId: integer("ownerUserId").references(() => users.id, { onDelete: "set null" }),
  sslForced: boolean("sslForced").notNull().default(true),
  hstsEnabled: boolean("hstsEnabled").notNull().default(true),
  hstsSubdomains: boolean("hstsSubdomains").notNull().default(false),
  allowWebsocket: boolean("allowWebsocket").notNull().default(true),
  preserveHostHeader: boolean("preserveHostHeader").notNull().default(true),
  meta: text("meta"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: text("createdAt").notNull(),
  updatedAt: text("updatedAt").notNull(),
  skipHttpsHostnameValidation: boolean("skipHttpsHostnameValidation").notNull().default(false),
});

export const apiTokens = pgTable(
  "api_tokens",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    tokenHash: text("tokenHash").notNull(),
    createdBy: integer("createdBy")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    createdAt: text("createdAt").notNull(),
    lastUsedAt: text("lastUsedAt"),
    expiresAt: text("expiresAt"),
  },
  (table) => ({
    tokenHashUnique: uniqueIndex("api_tokens_token_hash_unique").on(table.tokenHash),
  }),
);

export const auditEvents = pgTable("audit_events", {
  id: serial("id").primaryKey(),
  userId: integer("userId").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  entityType: text("entityType").notNull(),
  entityId: integer("entityId"),
  summary: text("summary"),
  data: text("data"),
  createdAt: text("createdAt").notNull(),
});

export const linkingTokens = pgTable("linking_tokens", {
  id: text("id").primaryKey(),
  token: text("token").notNull(),
  createdAt: text("createdAt").notNull(),
  expiresAt: text("expiresAt").notNull(),
});

// traffic_events and waf_events live in ClickHouse — see src/lib/clickhouse/client.ts. The
// parsers that fill them, and their read offsets, live in the agent: the Caddy log is a file on
// the agent's host, which a controller elsewhere cannot read at all.

// ── mTLS RBAC ──────────────────────────────────────────────────────────

export const mtlsRoles = pgTable(
  "mtls_roles",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    createdBy: integer("createdBy").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("createdAt").notNull(),
    updatedAt: text("updatedAt").notNull(),
  },
  (table) => ({
    nameUnique: uniqueIndex("mtls_roles_name_unique").on(table.name),
  }),
);

export const mtlsCertificateRoles = pgTable(
  "mtls_certificate_roles",
  {
    id: serial("id").primaryKey(),
    issuedClientCertificateId: integer("issuedClientCertificateId")
      .references(() => issuedClientCertificates.id, { onDelete: "cascade" })
      .notNull(),
    mtlsRoleId: integer("mtlsRoleId")
      .references(() => mtlsRoles.id, { onDelete: "cascade" })
      .notNull(),
    createdAt: text("createdAt").notNull(),
  },
  (table) => ({
    certRoleUnique: uniqueIndex("mtls_cert_role_unique").on(
      table.issuedClientCertificateId,
      table.mtlsRoleId,
    ),
    roleIdx: index("mtls_certificate_roles_role_idx").on(table.mtlsRoleId),
  }),
);

export const mtlsAccessRules = pgTable(
  "mtls_access_rules",
  {
    id: serial("id").primaryKey(),
    proxyHostId: integer("proxyHostId")
      .references(() => proxyHosts.id, { onDelete: "cascade" })
      .notNull(),
    pathPattern: text("pathPattern").notNull(),
    allowedRoleIds: text("allowedRoleIds").notNull().default("[]"),
    allowedCertIds: text("allowedCertIds").notNull().default("[]"),
    denyAll: boolean("denyAll").notNull().default(false),
    priority: integer("priority").notNull().default(0),
    description: text("description"),
    createdBy: integer("createdBy").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("createdAt").notNull(),
    updatedAt: text("updatedAt").notNull(),
  },
  (table) => ({
    proxyHostIdx: index("mtls_access_rules_proxy_host_idx").on(table.proxyHostId),
    hostPathUnique: uniqueIndex("mtls_access_rules_host_path_unique").on(
      table.proxyHostId,
      table.pathPattern,
    ),
  }),
);

// ── Forward Auth (IdP) ───────────────────────────────────────────────

export const groups = pgTable(
  "groups",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    createdBy: integer("createdBy").references(() => users.id, { onDelete: "set null" }),
    // "ui" for operator-managed groups, "oidc" for groups created by an IdP group sync. Only
    // "oidc" group membership is reconciled on sign-in.
    source: text("source").notNull().default("ui"),
    createdAt: text("createdAt").notNull(),
    updatedAt: text("updatedAt").notNull(),
  },
  (table) => ({
    nameUnique: uniqueIndex("groups_name_unique").on(table.name),
  }),
);

export const groupMembers = pgTable(
  "group_members",
  {
    id: serial("id").primaryKey(),
    groupId: integer("groupId")
      .references(() => groups.id, { onDelete: "cascade" })
      .notNull(),
    userId: integer("userId")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    createdAt: text("createdAt").notNull(),
  },
  (table) => ({
    memberUnique: uniqueIndex("group_members_unique").on(table.groupId, table.userId),
    userIdx: index("group_members_user_idx").on(table.userId),
  }),
);

export const forwardAuthAccess = pgTable(
  "forward_auth_access",
  {
    id: serial("id").primaryKey(),
    proxyHostId: integer("proxyHostId")
      .references(() => proxyHosts.id, { onDelete: "cascade" })
      .notNull(),
    userId: integer("userId").references(() => users.id, { onDelete: "cascade" }),
    groupId: integer("groupId").references(() => groups.id, { onDelete: "cascade" }),
    createdAt: text("createdAt").notNull(),
  },
  (table) => ({
    hostIdx: index("faa_host_idx").on(table.proxyHostId),
    userUnique: uniqueIndex("faa_user_unique").on(table.proxyHostId, table.userId),
    groupUnique: uniqueIndex("faa_group_unique").on(table.proxyHostId, table.groupId),
  }),
);

export const forwardAuthSessions = pgTable(
  "forward_auth_sessions",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    proxyHostId: integer("proxyHostId")
      .references(() => proxyHosts.id, { onDelete: "cascade" })
      .notNull(),
    audienceOrigin: text("audienceOrigin").notNull(),
    tokenHash: text("tokenHash").notNull(),
    expiresAt: text("expiresAt").notNull(),
    createdAt: text("createdAt").notNull(),
  },
  (table) => ({
    tokenHashUnique: uniqueIndex("fas_token_hash_unique").on(table.tokenHash),
    userIdx: index("fas_user_idx").on(table.userId),
    proxyHostIdx: index("fas_proxy_host_idx").on(table.proxyHostId),
    expiresIdx: index("fas_expires_idx").on(table.expiresAt),
  }),
);

export const forwardAuthExchanges = pgTable(
  "forward_auth_exchanges",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("sessionId")
      .references(() => forwardAuthSessions.id, { onDelete: "cascade" })
      .notNull(),
    proxyHostId: integer("proxyHostId")
      .references(() => proxyHosts.id, { onDelete: "cascade" })
      .notNull(),
    audienceOrigin: text("audienceOrigin").notNull(),
    codeHash: text("codeHash").notNull(),
    // Legacy compatibility column. Only a fixed placeholder is stored; the
    // replacement session token is generated at atomic redemption time.
    sessionToken: text("sessionToken").notNull(),
    redirectUri: text("redirectUri").notNull(),
    expiresAt: text("expiresAt").notNull(),
    used: boolean("used").notNull().default(false),
    createdAt: text("createdAt").notNull(),
  },
  (table) => ({
    codeHashUnique: uniqueIndex("fae_code_hash_unique").on(table.codeHash),
  }),
);

export const forwardAuthRedirectIntents = pgTable(
  "forward_auth_redirect_intents",
  {
    id: serial("id").primaryKey(),
    ridHash: text("ridHash").notNull(),
    proxyHostId: integer("proxyHostId")
      .references(() => proxyHosts.id, { onDelete: "cascade" })
      .notNull(),
    audienceOrigin: text("audienceOrigin").notNull(),
    redirectUri: text("redirectUri").notNull(),
    expiresAt: text("expiresAt").notNull(),
    consumed: boolean("consumed").notNull().default(false),
    createdAt: text("createdAt").notNull(),
  },
  (table) => ({
    ridHashUnique: uniqueIndex("fari_rid_hash_unique").on(table.ridHash),
    expiresIdx: index("fari_expires_idx").on(table.expiresAt),
  }),
);

// ── L4 Proxy Hosts ───────────────────────────────────────────────────

export const l4ProxyHosts = pgTable("l4_proxy_hosts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  protocol: text("protocol").notNull(),
  listenAddress: text("listenAddress").notNull(),
  upstreams: text("upstreams").notNull(),
  matcherType: text("matcherType").notNull().default("none"),
  matcherValue: text("matcherValue"),
  tlsTermination: boolean("tlsTermination").notNull().default(false),
  proxyProtocolVersion: text("proxyProtocolVersion"),
  proxyProtocolReceive: boolean("proxyProtocolReceive").notNull().default(false),
  ownerUserId: integer("ownerUserId").references(() => users.id, { onDelete: "set null" }),
  meta: text("meta"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: text("createdAt").notNull(),
  updatedAt: text("updatedAt").notNull(),
});
