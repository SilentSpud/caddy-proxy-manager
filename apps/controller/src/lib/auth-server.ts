import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { genericOAuth, username } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import db from "./db";
import * as schema from "./db/schema";
import { eq } from "drizzle-orm";
import { config } from "./config";
import { decryptSecret, encryptSecret, isEncryptedSecret } from "./secret";
import type { OAuthProvider } from "./models/oauth-providers";
import type { GenericOAuthConfig } from "better-auth/plugins";
import {
  extractGroups,
  mapGroupsToLocalGroups,
  mapGroupsToRole,
  needsGroupClaims,
  toGroupMappingConfig,
} from "./oidc-groups";
import { fetchOidcClaims, toOAuthUserInfo } from "./oidc-claims";
import { recordPendingOidcSync, reconcileOidcUserAfterSignIn } from "./services/oidc-group-sync";
import { hashPassword, verifyPassword } from "./password";
import { accountIssuerFor } from "./account-issuer";

// biome-ignore lint/suspicious/noExplicitAny: better-auth infers its instance type from the plugin list, which is assembled at runtime from the providers table
let cachedAuth: any = null;
let cachedProviders: GenericOAuthConfig[] | null = null;
let cachedTrustedProviderIds: string[] = [];

/**
 * OIDC spells the claim `email_verified`; some providers serialize it as a
 * string. Better Auth's generic-OAuth profile reader only looks at a camelCase
 * `emailVerified` field, so the claim has to be mapped explicitly.
 */
function profileEmailVerified(profile: Record<string, unknown>): boolean {
  const claim = profile.email_verified ?? profile.emailVerified;
  return claim === true || claim === "true";
}

export function mapOAuthProvider(p: OAuthProvider): GenericOAuthConfig {
  const cfg: GenericOAuthConfig = {
    providerId: p.id,
    clientId: p.clientId,
    clientSecret: p.clientSecret,
    scopes: p.scopes ? p.scopes.split(/[\s,]+/).filter(Boolean) : undefined,
    pkce: true,
    // Security: an OAuth sign-in must not implicitly create an account unless OAuth
    // self-registration is on. Only first-time auto-provisioning is gated; linking still works.
    disableImplicitSignUp: !config.auth.allowOauthRegistration,
    // Better Auth 1.7 scopes external identities by (issuer, accountId).
    // Pin the namespace to trusted application configuration so a provider
    // cannot choose or change its account namespace through profile claims.
    accountIssuer: accountIssuerFor(p.id, p.issuer),
    // Ownership of an existing CPM account is asserted by the operator through
    // the provider's auto-link switch, never by the IdP alone. Reporting the
    // claim only for auto-link providers keeps a provider that merely returns
    // `email_verified: true` from attaching itself to a local account.
    mapProfileToUser: (profile) => ({
      emailVerified: p.autoLink === true && profileEmailVerified(profile),
    }),
  };
  if (p.authorizationUrl) cfg.authorizationUrl = p.authorizationUrl;
  if (p.tokenUrl) cfg.tokenUrl = p.tokenUrl;
  if (p.userinfoUrl) cfg.userInfoUrl = p.userinfoUrl;
  if (p.issuer) {
    // Only use discovery when explicit URLs are not provided
    if (!p.authorizationUrl && !p.tokenUrl) {
      cfg.discoveryUrl = `${p.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
    }
  }

  const mapping = toGroupMappingConfig(p);
  if (needsGroupClaims(mapping)) {
    // Resolve claims ourselves so the group claim is found whether the IdP puts it in the ID
    // token or only on userinfo — better-auth stops at the ID token once it has sub and email.
    cfg.getUserInfo = async (tokens) => {
      const claims = await fetchOidcClaims(
        { issuer: p.issuer, userinfoUrl: p.userinfoUrl },
        { idToken: tokens.idToken, accessToken: tokens.accessToken },
        mapping.groupsClaim,
      );
      if (!claims) return null;
      // The raw claims ride along so mapProfileToUser can read the group claim; better-auth's
      // OAuth2UserInfo type declares only the standard fields.
      return toOAuthUserInfo(claims) as unknown as Awaited<
        ReturnType<NonNullable<GenericOAuthConfig["getUserInfo"]>>
      >;
    };

    // Runs on every sign-in through this provider, new and existing users alike. It only parks
    // the result: the user id isn't known here, so the mapping is applied at session creation.
    cfg.mapProfileToUser = (profile: Record<string, unknown>) => {
      const subject = profile.sub ?? profile.id;
      if (subject !== undefined && subject !== null) {
        const claimedGroups = extractGroups(profile, mapping.groupsClaim);
        recordPendingOidcSync({
          providerId: p.id,
          subject: String(subject),
          providerName: p.name,
          role: mapGroupsToRole(claimedGroups, mapping),
          localGroups: mapGroupsToLocalGroups(claimedGroups, mapping),
          syncGroups: mapping.syncGroups,
        });
      }
      // Privileged fields are never taken from the profile (see enforceSafeUserDefaults); the
      // role is applied by the sync instead.
      return {};
    };
  }

  return cfg;
}

/** Whether provider load succeeded at least once */
let providersLoadedSuccessfully = false;

async function loadProviders(): Promise<GenericOAuthConfig[]> {
  // If we have a successful cache, use it
  if (cachedProviders !== null && providersLoadedSuccessfully) return cachedProviders;

  // A cache left empty by a failed attempt is retried on every call until it succeeds
  try {
    const rows = await db
      .select()
      .from(schema.oauthProviders)
      .where(eq(schema.oauthProviders.enabled, true));
    const providers: OAuthProvider[] = rows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      clientId: decryptSecret(row.clientId),
      clientSecret: decryptSecret(row.clientSecret),
      issuer: row.issuer,
      authorizationUrl: row.authorizationUrl,
      tokenUrl: row.tokenUrl,
      userinfoUrl: row.userinfoUrl,
      scopes: row.scopes,
      autoLink: row.autoLink,
      enabled: row.enabled,
      source: row.source,
      groupsClaim: row.groupsClaim,
      groupPrefix: row.groupPrefix,
      roleMappingEnabled: row.roleMappingEnabled,
      adminGroup: row.adminGroup,
      userGroup: row.userGroup,
      viewerGroup: row.viewerGroup,
      defaultRole:
        row.defaultRole === "admin" || row.defaultRole === "viewer" ? row.defaultRole : "user",
      syncGroups: row.syncGroups,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
    cachedProviders = providers.map(mapOAuthProvider);
    cachedTrustedProviderIds = providers.filter((p) => p.autoLink).map((p) => p.id);
    providersLoadedSuccessfully = true;
  } catch (e) {
    // DB not ready yet — start with empty, will retry on next getAuth() call
    if (!cachedProviders) cachedProviders = [];
    console.warn("[auth-server] Failed to load OAuth providers (will retry):", e);
  }

  return cachedProviders;
}

/**
 * Security: force privileged fields to safe defaults on every better-auth-managed user creation.
 * Its generic-OAuth signup spreads raw IdP claims into the new user and ignores `input:false`, so
 * an IdP returning `role: "admin"` could self-provision one. models/user.ts bypasses these hooks.
 */
export function enforceSafeUserDefaults<T extends object>(
  user: T,
): T & { role: string; status: string } {
  return { ...user, role: "user", status: "active" };
}

// biome-ignore lint/suspicious/noExplicitAny: as cachedAuth above — the return type depends on a plugin list only known at runtime
async function createAuth(): Promise<any> {
  const oauthConfigs = await loadProviders();
  const trustedProviderIds = [...cachedTrustedProviderIds];

  return betterAuth({
    // `schema` is the whole module: the adapter resolves each model by the `modelName` configured
    // below, and those names already match the exported table bindings. Rows written by the
    // previous Kysely path stay readable — tests/integration/auth-adapter-compat.test.ts signs in
    // as a user created that way.
    database: drizzleAdapter(db, {
      provider: "pg",
      schema,
    }),
    secret: config.sessionSecret,
    baseURL: config.baseUrl,
    basePath: "/api/auth",
    // Only trust the Host header when the operator explicitly opts in. baseURL already pins the
    // canonical origin; trustHost is needed only behind reverse proxies that rewrite Host
    // without setting X-Forwarded-Host.
    trustHost: process.env.AUTH_TRUST_HOST === "true",
    trustedOrigins: [config.baseUrl],
    advanced: {
      database: {
        generateId: "serial",
      },
    } as Record<string, unknown>,
    rateLimit: {
      enabled: process.env.AUTH_RATE_LIMIT_ENABLED !== "false",
      window: Number(process.env.AUTH_RATE_LIMIT_WINDOW ?? 60),
      max: Number(process.env.AUTH_RATE_LIMIT_MAX ?? 5),
    },
    user: {
      modelName: "users",
      fields: {
        image: "avatarUrl",
      },
      additionalFields: {
        role: { type: "string", defaultValue: "user", input: false },
        status: { type: "string", defaultValue: "active", input: false },
        provider: { type: "string", defaultValue: "", input: false },
        subject: { type: "string", defaultValue: "", input: false },
      },
    },
    session: {
      modelName: "sessions",
      expiresIn: 7 * 24 * 60 * 60,
      cookieCache: { enabled: false },
    },
    account: {
      modelName: "accounts",
      accountLinking: {
        enabled: true,
        // A provider with "Auto-link accounts" enabled is trusted to prove that
        // its identity owns the CPM account carrying the same email address.
        trustedProviders: trustedProviderIds,
        // CPM has no local email-verification flow, so a user row's
        // emailVerified is never set and the default gate would refuse every
        // link. The per-provider trust decision above is the ownership signal.
        requireLocalEmailVerified: false,
      },
    },
    verification: { modelName: "verifications" },
    emailAndPassword: {
      // OIDC-only mode turns credential sign-in off entirely — there are no local accounts.
      enabled: !config.auth.disableLocalUsers,
      disableSignUp: !config.auth.allowSelfRegistration,
      password: {
        async hash(password: string) {
          return hashPassword(password);
        },
        async verify({ hash, password }: { hash: string; password: string }) {
          return verifyPassword(password, hash);
        },
      },
    },
    databaseHooks: {
      user: {
        create: {
          // By default, never let an external IdP set privileged fields (role/status) on a newly
          // federated user — see enforceSafeUserDefaults above. Operators who trust their IdP to
          // manage roles can opt out with AUTH_ALLOW_OAUTH_ROLE_FROM_CLAIMS=true.
          before: async (user: Record<string, unknown>) => {
            if (config.auth.allowOauthRoleFromClaims) {
              return { data: user };
            }
            return { data: enforceSafeUserDefaults(user) };
          },
        },
      },
      account: {
        create: {
          before: async (account) => {
            const data = { ...account };
            if (data.accessToken) data.accessToken = encryptSecret(data.accessToken);
            if (data.refreshToken) data.refreshToken = encryptSecret(data.refreshToken);
            if (data.idToken) data.idToken = encryptSecret(data.idToken);
            return { data };
          },
        },
        update: {
          before: async (account) => {
            const data = { ...account };
            if (data.accessToken && !isEncryptedSecret(data.accessToken))
              data.accessToken = encryptSecret(data.accessToken);
            if (data.refreshToken && !isEncryptedSecret(data.refreshToken))
              data.refreshToken = encryptSecret(data.refreshToken);
            if (data.idToken && !isEncryptedSecret(data.idToken))
              data.idToken = encryptSecret(data.idToken);
            return { data };
          },
        },
      },
      session: {
        create: {
          after: async (session) => {
            const userId =
              typeof session.userId === "string" ? Number(session.userId) : session.userId;

            // Apply the IdP's group claim now that the user and account rows exist. Runs before
            // the audit entry so a role change is in effect for anything reading the session.
            try {
              await reconcileOidcUserAfterSignIn(userId);
            } catch (error) {
              console.warn("[auth-server] OIDC group sync failed:", error);
            }

            try {
              const { createAuditEvent } = await import("./models/audit");
              await createAuditEvent({
                userId,
                action: "login_success",
                entityType: "session",
                entityId: null,
                summary: "User signed in",
              });
            } catch {
              // Don't break auth flow if audit logging fails
            }
          },
        },
      },
    },
    plugins: [
      // Cast via unknown: better-auth's `username` plugin types `email: string` where
      // BetterAuthPlugin expects `email?: any`, and the mismatch is environment-dependent.
      username({
        maxUsernameLength: 255,
        usernameValidator: (username) => /^[a-zA-Z0-9_.@-]+$/.test(username),
      }) as unknown as BetterAuthPlugin,
      genericOAuth({ config: oauthConfigs }),
    ],
  });
}

export async function getAuth(): Promise<ReturnType<typeof betterAuth>> {
  // Rebuild if providers failed to load initially and are now available
  if (cachedAuth && !providersLoadedSuccessfully) {
    cachedProviders = null;
    cachedAuth = null;
  }
  if (!cachedAuth) {
    // Cache the promise, not the resolved instance: concurrent first requests would otherwise each
    // build their own Better Auth instance and the last one to finish would win.
    cachedAuth = createAuth();
  }
  return await cachedAuth;
}

export function invalidateProviderCache(): void {
  cachedProviders = null;
  cachedTrustedProviderIds = [];
  providersLoadedSuccessfully = false;
  cachedAuth = null;
}
