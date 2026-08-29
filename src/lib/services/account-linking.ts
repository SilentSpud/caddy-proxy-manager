import { verifyPassword } from "../password";
import { randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { config } from "../config";
import { findUserByEmail, getUserById } from "../models/user";
import db from "../db";
import { users, linkingTokens, accounts, oauthProviders } from "../db/schema";
import { and, eq, lt } from "drizzle-orm";
import { nowIso } from "../db";
import { accountIssuerFor } from "../account-issuer";

const LINKING_TOKEN_EXPIRY = 5 * 60; // 5 minutes in seconds

/**
 * The issuer to stamp on a linked OAuth account row. better-auth 1.7 keys accounts by
 * (issuer, accountId), so a mismatch means the link exists but never resolves.
 */
async function issuerForProvider(providerId: string): Promise<string> {
  const row = await db
    .select({ issuer: oauthProviders.issuer })
    .from(oauthProviders)
    .where(eq(oauthProviders.id, providerId))
    .get();
  return accountIssuerFor(providerId, row?.issuer);
}

export type LinkingDecision = {
  action: "auto_link" | "require_manual_link" | "create_new" | "signin_existing";
  userId?: number;
  reason: string;
};

export type LinkingTokenPayload = {
  userId: number;
  provider: string;
  providerAccountId: string;
  email: string;
  exp: number;
};

/** Determines how to handle an OAuth sign-in attempt. */
export async function decideLinkingStrategy(
  provider: string,
  providerAccountId: string,
  email: string,
): Promise<LinkingDecision> {
  const issuer = await issuerForProvider(provider);
  // Check accounts table for existing OAuth connection
  const existingAccount = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.issuer, issuer), eq(accounts.accountId, providerAccountId)))
    .limit(1);

  if (existingAccount.length > 0) {
    return {
      action: "signin_existing",
      userId: existingAccount[0].userId,
      reason: "OAuth account already linked",
    };
  }

  // Check if email matches existing user
  const existingEmailUser = await findUserByEmail(email);
  if (!existingEmailUser) {
    return {
      action: "create_new",
      reason: "No existing account with this email",
    };
  }

  // User exists with this email
  if (existingEmailUser.passwordHash) {
    // Has password - require manual linking with password verification
    return {
      action: "require_manual_link",
      userId: existingEmailUser.id,
      reason: "Account has password - requires manual linking",
    };
  }

  // No password (OAuth-only account)
  if (config.oauth.allowAutoLinking) {
    return {
      action: "auto_link",
      userId: existingEmailUser.id,
      reason: "Account has no password - auto-linking enabled",
    };
  }

  return {
    action: "require_manual_link",
    userId: existingEmailUser.id,
    reason: "Auto-linking disabled",
  };
}

/** Create a temporary linking token (5-minute expiry). */
export async function createLinkingToken(
  userId: number,
  provider: string,
  providerAccountId: string,
  email: string,
): Promise<string> {
  const secret = new TextEncoder().encode(config.sessionSecret);

  const token = await new SignJWT({
    userId,
    provider,
    providerAccountId,
    email,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(`${LINKING_TOKEN_EXPIRY}s`)
    .setIssuedAt()
    .sign(secret);

  return token;
}

/** Verify and decode a linking token. */
export async function verifyLinkingToken(token: string): Promise<LinkingTokenPayload | null> {
  try {
    const secret = new TextEncoder().encode(config.sessionSecret);
    const { payload } = await jwtVerify(token, secret);

    return {
      userId: payload.userId as number,
      provider: payload.provider as string,
      providerAccountId: payload.providerAccountId as string,
      email: payload.email as string,
      exp: payload.exp as number,
    };
  } catch (error) {
    console.error("Token verification failed:", error);
    return null;
  }
}

/** Store a linking JWT and return an opaque 64-char hex ID. Expired rows are purged on insert. */
export async function storeLinkingToken(token: string): Promise<string> {
  const id = randomBytes(32).toString("hex");
  const now = nowIso();
  const expiresAt = new Date(Date.now() + LINKING_TOKEN_EXPIRY * 1000).toISOString();

  // Purge expired tokens opportunistically
  await db.delete(linkingTokens).where(lt(linkingTokens.expiresAt, now));

  await db.insert(linkingTokens).values({
    id,
    token,
    createdAt: now,
    expiresAt,
  });
  return id;
}

/**
 * Peek at a linking token without consuming it, so the link-account page can show provider and
 * email while leaving the token for the API call. Null if unknown or expired.
 */
export async function peekLinkingToken(id: string): Promise<string | null> {
  const now = nowIso();
  const rows = await db.select().from(linkingTokens).where(eq(linkingTokens.id, id)).limit(1);
  if (rows.length === 0 || rows[0].expiresAt < now) {
    return null;
  }
  return rows[0].token;
}

/** Retrieve and delete a linking token by opaque ID (one-time). Null if unknown or expired. */
export async function retrieveLinkingToken(id: string): Promise<string | null> {
  const now = nowIso();
  const rows = await db.select().from(linkingTokens).where(eq(linkingTokens.id, id)).limit(1);
  if (rows.length === 0 || rows[0].expiresAt < now) {
    return null;
  }
  const { token } = rows[0];
  await db.delete(linkingTokens).where(eq(linkingTokens.id, id));
  return token;
}

/** Verify the password and link an OAuth account to an existing user. */
export async function verifyAndLinkOAuth(
  userId: number,
  password: string,
  provider: string,
  providerAccountId: string,
): Promise<boolean> {
  const user = await getUserById(userId);
  if (!user?.passwordHash) {
    return false;
  }

  // Verify password
  const isValid = await verifyPassword(password, user.passwordHash);
  if (!isValid) {
    return false;
  }

  // Insert OAuth account link
  const issuer = await issuerForProvider(provider);
  await db.insert(accounts).values({
    userId,
    issuer,
    accountId: providerAccountId,
    providerId: provider,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });

  return true;
}

/** Auto-link an OAuth account, for users without passwords. */
export async function autoLinkOAuth(
  userId: number,
  provider: string,
  providerAccountId: string,
  avatarUrl?: string | null,
): Promise<boolean> {
  const user = await getUserById(userId);
  if (!user) {
    return false;
  }

  // Don't auto-link if the user has a password; bypassed by the authenticated linking flow.
  if (user.passwordHash && !config.oauth.allowAutoLinking) {
    return false;
  }

  // Insert OAuth account link
  const issuer = await issuerForProvider(provider);
  await db.insert(accounts).values({
    userId,
    issuer,
    accountId: providerAccountId,
    providerId: provider,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });

  // Update avatar if provided
  if (avatarUrl) {
    await db.update(users).set({ avatarUrl, updatedAt: nowIso() }).where(eq(users.id, userId));
  }

  return true;
}

/**
 * Link an OAuth account for an already-authenticated user, bypassing the password check.
 */
export async function linkOAuthAuthenticated(
  userId: number,
  provider: string,
  providerAccountId: string,
  avatarUrl?: string | null,
): Promise<boolean> {
  const user = await getUserById(userId);
  if (!user) {
    return false;
  }

  // Insert OAuth account link
  const issuer = await issuerForProvider(provider);
  await db.insert(accounts).values({
    userId,
    issuer,
    accountId: providerAccountId,
    providerId: provider,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });

  // Update avatar if provided
  if (avatarUrl) {
    await db.update(users).set({ avatarUrl, updatedAt: nowIso() }).where(eq(users.id, userId));
  }

  return true;
}
