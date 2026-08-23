import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { genericOAuth, username } from "better-auth/plugins";
import db, { sqlite } from "./db";
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

// biome-ignore lint/suspicious/noExplicitAny: better-auth infers its instance type from the plugin list, which is assembled at runtime from the providers table
let cachedAuth: any = null;
let cachedProviders: GenericOAuthConfig[] | null = null;

export function mapOAuthProvider(p: OAuthProvider): GenericOAuthConfig {
  const cfg: GenericOAuthConfig = {
    providerId: p.id,
    clientId: p.clientId,
    clientSecret: p.clientSecret,
    scopes: p.scopes ? p.scopes.split(/[\s,]+/).filter(Boolean) : undefined,
    pkce: true,
    // Security: do not let an OAuth sign-in implicitly create a brand-new
    // account unless OAuth self-registration is explicitly enabled. Existing
    // users and (where configured) account linking still work — only first-time
    // auto-provisioning of an unknown identity is gated. Controlled by its own
    // flag, independent of credential self-registration.
    disableImplicitSignUp: !config.auth.allowOauthRegistration,
  };
  if (p.authorizationUrl) cfg.authorizationUrl = p.authorizationUrl;
  if (p.tokenUrl) cfg.tokenUrl = p.tokenUrl;
  if (p.userinfoUrl) cfg.userInfoUrl = p.userinfoUrl;
  if (p.issuer) {
    // better-auth 1.7 renamed `issuer` to `accountIssuer`: the stable namespace
    // paired with the provider account id. Discovery providers fall back to the
    // issuer found in the discovery document, but providers configured with
    // explicit endpoints have none, so setting it keeps account identity stable
    // across both shapes.
    cfg.accountIssuer = p.issuer;
    // Only use discovery when explicit URLs are not provided
    if (!p.authorizationUrl && !p.tokenUrl) {
      cfg.discoveryUrl = p.issuer.replace(/\/$/, "") + "/.well-known/openid-configuration";
    }
  }

  const mapping = toGroupMappingConfig(p);
  if (needsGroupClaims(mapping)) {
    // Resolve claims ourselves so the group claim is found whether the IdP puts
    // it in the ID token or only on userinfo — better-auth's default stops at
    // the ID token as soon as it has a sub and an email.
    cfg.getUserInfo = async (tokens) => {
      const claims = await fetchOidcClaims(
        { issuer: p.issuer, userinfoUrl: p.userinfoUrl },
        { idToken: tokens.idToken, accessToken: tokens.accessToken },
        mapping.groupsClaim,
      );
      if (!claims) return null;
      // The raw claims ride along so mapProfileToUser can read the group claim;
      // better-auth's OAuth2UserInfo type only declares the standard fields.
      return toOAuthUserInfo(claims) as unknown as Awaited<
        ReturnType<NonNullable<GenericOAuthConfig["getUserInfo"]>>
      >;
    };

    // Runs on every sign-in through this provider, for new and existing users
    // alike. It only parks the result: the user id isn't known here, so the
    // mapping is applied once the sign-in reaches session creation.
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
      // Privileged fields are never taken from the profile — see
      // enforceSafeUserDefaults below. The role is applied by the sync instead.
      return {};
    };
  }

  return cfg;
}

/** Whether provider load succeeded at least once */
let providersLoadedSuccessfully = false;

function loadProvidersSync(): GenericOAuthConfig[] {
  // If we have a successful cache, use it
  if (cachedProviders !== null && providersLoadedSuccessfully) return cachedProviders;

  // If cache is empty from a failed attempt, retry on every call until it succeeds
  try {
    const rows = db
      .select()
      .from(schema.oauthProviders)
      .where(eq(schema.oauthProviders.enabled, true))
      .all();
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
    providersLoadedSuccessfully = true;
  } catch (e) {
    // DB not ready yet — start with empty, will retry on next getAuth() call
    if (!cachedProviders) cachedProviders = [];
    console.warn("[auth-server] Failed to load OAuth providers (will retry):", e);
  }

  return cachedProviders;
}

/**
 * Security: force privileged user fields to safe defaults on every
 * better-auth-managed user creation (OAuth signup, and credential signup when
 * enabled). better-auth's generic-OAuth signup spreads the raw IdP profile
 * claims into the new user record (createOAuthUser({...restUserInfo})) and does
 * NOT honour the `input:false` flags declared on these additionalFields, so
 * without this a permissive or attacker-influenced IdP returning a `role` (or
 * `status`) claim could self-provision an admin account.
 *
 * Admin-initiated user creation goes through models/user.ts (a direct insert
 * that bypasses better-auth's database hooks), so legitimate role assignment is
 * unaffected. `provider`/`subject` are informational, not access-control, and
 * are intentionally left untouched.
 */
export function enforceSafeUserDefaults<T extends object>(
  user: T,
): T & { role: string; status: string } {
  return { ...user, role: "user", status: "active" };
}

// biome-ignore lint/suspicious/noExplicitAny: as cachedAuth above — the return type depends on a plugin list only known at runtime
function createAuth(): any {
  const oauthConfigs = loadProvidersSync();

  return betterAuth({
    database: sqlite,
    secret: config.sessionSecret,
    baseURL: config.baseUrl,
    basePath: "/api/auth",
    // Only trust the Host header when the operator explicitly opts in.
    // baseURL already pins the canonical origin; trustHost is only needed
    // behind reverse proxies that rewrite Host without setting X-Forwarded-Host.
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
    account: { modelName: "accounts" },
    verification: { modelName: "verifications" },
    emailAndPassword: {
      // OIDC-only mode turns credential sign-in off entirely — there are no
      // local accounts to sign in with.
      enabled: !config.auth.disableLocalUsers,
      disableSignUp: !config.auth.allowSelfRegistration,
      password: {
        async hash(password: string) {
          const bcrypt = await import("bcryptjs");
          return bcrypt.default.hashSync(password, 12);
        },
        async verify({ hash, password }: { hash: string; password: string }) {
          const bcrypt = await import("bcryptjs");
          return bcrypt.default.compareSync(password, hash);
        },
      },
    },
    databaseHooks: {
      user: {
        create: {
          // By default, never let an external IdP set privileged fields
          // (role/status) on a newly federated user — see enforceSafeUserDefaults
          // above. Operators who trust their IdP to manage roles can opt out
          // with AUTH_ALLOW_OAUTH_ROLE_FROM_CLAIMS=true.
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

            // Apply the IdP's group claim now that the user and their account
            // row exist. Runs before the audit entry so a role change is in
            // effect for anything that reads the session afterwards.
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
      // Cast via unknown: better-auth's `username` plugin declares
      // databaseHooks.user.create.before's `email: string` (required) while BetterAuthPlugin
      // expects `email?: any`. The mismatch surfaces in some environments and not others, so
      // the cast keeps the typecheck stable across local and Docker builds.
      username({
        maxUsernameLength: 255,
        usernameValidator: (username) => /^[a-zA-Z0-9_.@-]+$/.test(username),
      }) as unknown as BetterAuthPlugin,
      genericOAuth({ config: oauthConfigs }),
    ],
  });
}

export function getAuth(): ReturnType<typeof betterAuth> {
  // Rebuild if providers failed to load initially and are now available
  if (cachedAuth && !providersLoadedSuccessfully) {
    cachedProviders = null;
    cachedAuth = null;
  }
  if (!cachedAuth) {
    cachedAuth = createAuth();
  }
  return cachedAuth;
}

export function invalidateProviderCache(): void {
  cachedProviders = null;
  providersLoadedSuccessfully = false;
  cachedAuth = null;
}
