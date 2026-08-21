import { randomUUID } from "node:crypto";
import db, { nowIso } from "../db";
import { oauthProviders } from "../db/schema";
import { eq } from "drizzle-orm";
import { encryptSecret, decryptSecret } from "../secret";
import type { AppRole } from "../oidc-groups";
import { isAppRole } from "../oidc-groups";

/** Per-provider OIDC group mapping, shared by the type, create and update paths. */
export type OAuthGroupMapping = {
  groupsClaim: string;
  groupPrefix: string | null;
  roleMappingEnabled: boolean;
  adminGroup: string | null;
  userGroup: string | null;
  viewerGroup: string | null;
  defaultRole: AppRole;
  syncGroups: boolean;
};

export type OAuthProvider = OAuthGroupMapping & {
  id: string;
  name: string;
  type: string;
  clientId: string;
  clientSecret: string;
  issuer: string | null;
  authorizationUrl: string | null;
  tokenUrl: string | null;
  userinfoUrl: string | null;
  scopes: string;
  autoLink: boolean;
  enabled: boolean;
  source: string;
  createdAt: string;
  updatedAt: string;
};

type DbProvider = typeof oauthProviders.$inferSelect;

function parseDbProvider(row: DbProvider): OAuthProvider {
  return {
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
    defaultRole: isAppRole(row.defaultRole) ? row.defaultRole : "user",
    syncGroups: row.syncGroups,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function createOAuthProvider(data: {
  name: string;
  type?: string;
  clientId: string;
  clientSecret: string;
  issuer?: string | null;
  authorizationUrl?: string | null;
  tokenUrl?: string | null;
  userinfoUrl?: string | null;
  scopes?: string;
  autoLink?: boolean;
  enabled?: boolean;
  source?: string;
} & Partial<OAuthGroupMapping>): Promise<OAuthProvider> {
  const now = nowIso();
  const id = randomUUID();

  const [row] = await db
    .insert(oauthProviders)
    .values({
      id,
      name: data.name,
      type: data.type ?? "oidc",
      clientId: encryptSecret(data.clientId),
      clientSecret: encryptSecret(data.clientSecret),
      issuer: data.issuer ?? null,
      authorizationUrl: data.authorizationUrl ?? null,
      tokenUrl: data.tokenUrl ?? null,
      userinfoUrl: data.userinfoUrl ?? null,
      scopes: data.scopes ?? "openid email profile",
      autoLink: data.autoLink ?? false,
      enabled: data.enabled ?? true,
      source: data.source ?? "ui",
      groupsClaim: data.groupsClaim?.trim() || "groups",
      groupPrefix: data.groupPrefix?.trim() || null,
      roleMappingEnabled: data.roleMappingEnabled ?? false,
      adminGroup: data.adminGroup?.trim() || null,
      userGroup: data.userGroup?.trim() || null,
      viewerGroup: data.viewerGroup?.trim() || null,
      defaultRole: isAppRole(data.defaultRole) ? data.defaultRole : "user",
      syncGroups: data.syncGroups ?? false,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return parseDbProvider(row);
}

export async function listOAuthProviders(): Promise<OAuthProvider[]> {
  const rows = await db.query.oauthProviders.findMany({
    orderBy: (table, { asc }) => asc(table.name),
  });
  return rows.map(parseDbProvider);
}

export async function listEnabledOAuthProviders(): Promise<OAuthProvider[]> {
  const rows = await db.query.oauthProviders.findMany({
    where: (table, { eq }) => eq(table.enabled, true),
    orderBy: (table, { asc }) => asc(table.name),
  });
  return rows.map(parseDbProvider);
}

export async function getOAuthProvider(id: string): Promise<OAuthProvider | null> {
  const row = await db.query.oauthProviders.findFirst({
    where: (table, { eq }) => eq(table.id, id),
  });
  return row ? parseDbProvider(row) : null;
}

export async function getOAuthProviderByName(name: string): Promise<OAuthProvider | null> {
  const row = await db.query.oauthProviders.findFirst({
    where: (table, { eq }) => eq(table.name, name),
  });
  return row ? parseDbProvider(row) : null;
}

export async function updateOAuthProvider(
  id: string,
  data: Partial<{
    name: string;
    type: string;
    clientId: string;
    clientSecret: string;
    issuer: string | null;
    authorizationUrl: string | null;
    tokenUrl: string | null;
    userinfoUrl: string | null;
    scopes: string;
    autoLink: boolean;
    enabled: boolean;
  }> & Partial<OAuthGroupMapping>
): Promise<OAuthProvider | null> {
  const now = nowIso();

  const updates: Record<string, unknown> = { updatedAt: now };

  if (data.name !== undefined) updates.name = data.name;
  if (data.type !== undefined) updates.type = data.type;
  if (data.clientId !== undefined) updates.clientId = encryptSecret(data.clientId);
  if (data.clientSecret !== undefined) updates.clientSecret = encryptSecret(data.clientSecret);
  if (data.issuer !== undefined) updates.issuer = data.issuer;
  if (data.authorizationUrl !== undefined) updates.authorizationUrl = data.authorizationUrl;
  if (data.tokenUrl !== undefined) updates.tokenUrl = data.tokenUrl;
  if (data.userinfoUrl !== undefined) updates.userinfoUrl = data.userinfoUrl;
  if (data.scopes !== undefined) updates.scopes = data.scopes;
  if (data.autoLink !== undefined) updates.autoLink = data.autoLink;
  if (data.enabled !== undefined) updates.enabled = data.enabled;
  if (data.groupsClaim !== undefined) updates.groupsClaim = data.groupsClaim.trim() || "groups";
  if (data.groupPrefix !== undefined) updates.groupPrefix = data.groupPrefix?.trim() || null;
  if (data.roleMappingEnabled !== undefined) updates.roleMappingEnabled = data.roleMappingEnabled;
  if (data.adminGroup !== undefined) updates.adminGroup = data.adminGroup?.trim() || null;
  if (data.userGroup !== undefined) updates.userGroup = data.userGroup?.trim() || null;
  if (data.viewerGroup !== undefined) updates.viewerGroup = data.viewerGroup?.trim() || null;
  if (data.defaultRole !== undefined) updates.defaultRole = isAppRole(data.defaultRole) ? data.defaultRole : "user";
  if (data.syncGroups !== undefined) updates.syncGroups = data.syncGroups;

  const [row] = await db
    .update(oauthProviders)
    .set(updates)
    .where(eq(oauthProviders.id, id))
    .returning();

  return row ? parseDbProvider(row) : null;
}

export async function deleteOAuthProvider(id: string): Promise<void> {
  const row = await db.query.oauthProviders.findFirst({
    where: (table, { eq }) => eq(table.id, id),
  });

  if (!row) {
    throw new Error("OAuth provider not found");
  }

  if (row.source === "env") {
    throw new Error("Cannot delete an environment-sourced OAuth provider");
  }

  await db.delete(oauthProviders).where(eq(oauthProviders.id, id));
}

export async function getProviderDisplayList(): Promise<Array<{ id: string; name: string }>> {
  const rows = await db.query.oauthProviders.findMany({
    where: (table, { eq }) => eq(table.enabled, true),
    orderBy: (table, { asc }) => asc(table.name),
    columns: { id: true, name: true },
  });
  return rows.map((r) => ({ id: r.id, name: r.name }));
}
