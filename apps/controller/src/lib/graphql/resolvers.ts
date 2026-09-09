/**
 * Resolvers.
 *
 * Every one of these calls the same model function the matching `/api/v1/` route calls. That is
 * the whole design: validation, audit logging, permission checks and error shapes are the model
 * layer's, so GraphQL and REST cannot disagree about what a mutation does - and the parity tests
 * can assert it rather than trust it.
 *
 * Two things are projected rather than returned whole:
 *
 * - **Users**, because the model row carries `passwordHash` and the OAuth `subject`. Projecting
 *   named fields means a future column cannot start leaking through a resolver nobody revisited.
 * - **Certificates**, for the same reason: the row holds the private key.
 *
 * Everything else is returned as the model shaped it, with the free-form remainder gathered into
 * `config` so nothing is unreachable.
 */

import { applyCaddyConfig as applyCaddy } from "../caddy";
import { DNS_PROVIDERS } from "../dns-providers";
import { getCaddyModuleAvailability } from "../caddy-build";
import {
  listAccessLists,
  getAccessList,
  createAccessList,
  updateAccessList,
  deleteAccessList,
} from "../models/access-lists";
import { listAgents } from "../models/agents";
import { createApiToken, deleteApiToken, listApiTokens } from "../models/api-tokens";
import { countAuditEvents, listAuditEvents } from "../models/audit";
import { listCaCertificates } from "../models/ca-certificates";
import { listCertificates, getCertificate } from "../models/certificates";
import {
  addGroupMember,
  createGroup,
  deleteGroup,
  getGroup,
  listGroups,
  removeGroupMember,
  updateGroup,
} from "../models/groups";
import { listIssuedClientCertificates } from "../models/issued-client-certificates";
import {
  createL4ProxyHost,
  deleteL4ProxyHost,
  getL4ProxyHost,
  listL4ProxyHosts,
  updateL4ProxyHost,
} from "../models/l4-proxy-hosts";
import { listMtlsRoles } from "../models/mtls-roles";
import { listOAuthProviders } from "../models/oauth-providers";
import {
  createProxyHost,
  deleteProxyHost,
  getProxyHost,
  listProxyHosts,
  updateProxyHost,
} from "../models/proxy-hosts";
import { deleteUser, getUserById, listUsers, updateUserRole } from "../models/user";
import { getSetting, setSetting } from "../settings";
import { validateSettingsGroup } from "../settings-validation";
import { type GraphQLContext, requireAdmin } from "./context";
import { DateTimeScalar, JSONScalar } from "./scalars";

/** Fields promoted to real schema fields on ProxyHost; the rest becomes `config`. */
const PROXY_HOST_SCALAR_FIELDS = new Set([
  "id",
  "name",
  "domains",
  "upstreams",
  "enabled",
  "certificateId",
  "accessListId",
  "sslForced",
  "hstsEnabled",
  "hstsSubdomains",
  "allowWebsocket",
  "preserveHostHeader",
  "skipHttpsHostnameValidation",
  "createdAt",
  "updatedAt",
]);

const L4_SCALAR_FIELDS = new Set([
  "id",
  "name",
  "protocol",
  "listenAddress",
  "upstreams",
  "matcherType",
  "matcherValue",
  "tlsTermination",
  "proxyProtocolVersion",
  "proxyProtocolReceive",
  "enabled",
  "createdAt",
  "updatedAt",
]);

/** Whatever the type does not name as a field, so nothing on the model is unreachable. */
function remainder(row: Record<string, unknown>, promoted: Set<string>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !promoted.has(key)));
}

type CertificateRow = Awaited<ReturnType<typeof listCertificates>>[number];
type UserRow = Awaited<ReturnType<typeof listUsers>>[number];

/** Named fields only. The row carries a private key. */
function projectCertificate(row: CertificateRow) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    domainNames: row.domainNames,
    autoRenew: row.autoRenew,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Named fields only. The row carries a password hash and the OAuth subject. */
function projectUser(row: UserRow) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    status: row.status,
    provider: row.provider,
    avatarUrl: row.avatarUrl,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export const resolvers = {
  JSON: JSONScalar,
  DateTime: DateTimeScalar,

  ProxyHost: {
    config: (host: Record<string, unknown>) => remainder(host, PROXY_HOST_SCALAR_FIELDS),
  },
  L4ProxyHost: {
    config: (host: Record<string, unknown>) => remainder(host, L4_SCALAR_FIELDS),
  },

  Query: {
    proxyHosts: async (_: unknown, __: unknown, context: GraphQLContext) => {
      await requireAdmin(context);
      return await listProxyHosts();
    },
    proxyHost: async (_: unknown, args: { id: number }, context: GraphQLContext) => {
      await requireAdmin(context);
      return await getProxyHost(args.id);
    },
    l4ProxyHosts: async (_: unknown, __: unknown, context: GraphQLContext) => {
      await requireAdmin(context);
      return await listL4ProxyHosts();
    },
    l4ProxyHost: async (_: unknown, args: { id: number }, context: GraphQLContext) => {
      await requireAdmin(context);
      return await getL4ProxyHost(args.id);
    },
    certificates: async (_: unknown, __: unknown, context: GraphQLContext) => {
      await requireAdmin(context);
      return (await listCertificates()).map(projectCertificate);
    },
    certificate: async (_: unknown, args: { id: number }, context: GraphQLContext) => {
      await requireAdmin(context);
      const row = await getCertificate(args.id);
      return row ? projectCertificate(row) : null;
    },
    caCertificates: async (_: unknown, __: unknown, context: GraphQLContext) => {
      await requireAdmin(context);
      return await listCaCertificates();
    },
    clientCertificates: async (_: unknown, __: unknown, context: GraphQLContext) => {
      await requireAdmin(context);
      return await listIssuedClientCertificates();
    },
    mtlsRoles: async (_: unknown, __: unknown, context: GraphQLContext) => {
      await requireAdmin(context);
      return await listMtlsRoles();
    },
    accessLists: async (_: unknown, __: unknown, context: GraphQLContext) => {
      await requireAdmin(context);
      return await listAccessLists();
    },
    accessList: async (_: unknown, args: { id: number }, context: GraphQLContext) => {
      await requireAdmin(context);
      return await getAccessList(args.id);
    },
    users: async (_: unknown, __: unknown, context: GraphQLContext) => {
      await requireAdmin(context);
      return (await listUsers()).map(projectUser);
    },
    user: async (_: unknown, args: { id: number }, context: GraphQLContext) => {
      await requireAdmin(context);
      const row = await getUserById(args.id);
      return row ? projectUser(row) : null;
    },
    groups: async (_: unknown, __: unknown, context: GraphQLContext) => {
      await requireAdmin(context);
      return await listGroups();
    },
    group: async (_: unknown, args: { id: number }, context: GraphQLContext) => {
      await requireAdmin(context);
      return await getGroup(args.id);
    },
    apiTokens: async (_: unknown, __: unknown, context: GraphQLContext) => {
      // Not admin-gated: every role manages its own tokens, exactly as over REST.
      const viewer = await context.viewer();
      return await listApiTokens(viewer.userId);
    },
    agents: async (_: unknown, __: unknown, context: GraphQLContext) => {
      await requireAdmin(context);
      return await listAgents();
    },
    oauthProviders: async (_: unknown, __: unknown, context: GraphQLContext) => {
      await requireAdmin(context);
      return await listOAuthProviders();
    },
    dnsProviders: async (_: unknown, __: unknown, context: GraphQLContext) => {
      await requireAdmin(context);
      // `configured` is deliberately not answered here: whether credentials exist is a settings
      // read per provider, and the REST route does not answer it either. Listing what the build
      // supports is the question this field is for.
      return DNS_PROVIDERS.map((provider) => ({
        id: provider.name,
        name: provider.displayName,
        configured: false,
      }));
    },
    auditLog: async (
      _: unknown,
      args: { limit?: number; offset?: number; search?: string },
      context: GraphQLContext,
    ) => {
      await requireAdmin(context);
      const [items, total] = await Promise.all([
        listAuditEvents(args.limit ?? 100, args.offset ?? 0, args.search),
        countAuditEvents(args.search),
      ]);
      return { items, total };
    },
    settings: async (_: unknown, args: { group: string }, context: GraphQLContext) => {
      await requireAdmin(context);
      return await getSetting(args.group);
    },
    caddyModules: async (_: unknown, __: unknown, context: GraphQLContext) => {
      await requireAdmin(context);
      return await getCaddyModuleAvailability();
    },
  },

  Mutation: {
    createProxyHost: async (_: unknown, args: { input: unknown }, context: GraphQLContext) => {
      const { userId } = await requireAdmin(context);
      return await createProxyHost(args.input as never, userId);
    },
    updateProxyHost: async (
      _: unknown,
      args: { id: number; input: unknown },
      context: GraphQLContext,
    ) => {
      const { userId } = await requireAdmin(context);
      return await updateProxyHost(args.id, args.input as never, userId);
    },
    deleteProxyHost: async (_: unknown, args: { id: number }, context: GraphQLContext) => {
      const { userId } = await requireAdmin(context);
      await deleteProxyHost(args.id, userId);
      return true;
    },

    createL4ProxyHost: async (_: unknown, args: { input: unknown }, context: GraphQLContext) => {
      const { userId } = await requireAdmin(context);
      return await createL4ProxyHost(args.input as never, userId);
    },
    updateL4ProxyHost: async (
      _: unknown,
      args: { id: number; input: unknown },
      context: GraphQLContext,
    ) => {
      const { userId } = await requireAdmin(context);
      return await updateL4ProxyHost(args.id, args.input as never, userId);
    },
    deleteL4ProxyHost: async (_: unknown, args: { id: number }, context: GraphQLContext) => {
      const { userId } = await requireAdmin(context);
      await deleteL4ProxyHost(args.id, userId);
      return true;
    },

    createAccessList: async (_: unknown, args: { input: unknown }, context: GraphQLContext) => {
      const { userId } = await requireAdmin(context);
      return await createAccessList(args.input as never, userId);
    },
    updateAccessList: async (
      _: unknown,
      args: { id: number; input: unknown },
      context: GraphQLContext,
    ) => {
      const { userId } = await requireAdmin(context);
      return await updateAccessList(args.id, args.input as never, userId);
    },
    deleteAccessList: async (_: unknown, args: { id: number }, context: GraphQLContext) => {
      const { userId } = await requireAdmin(context);
      await deleteAccessList(args.id, userId);
      return true;
    },

    createGroup: async (_: unknown, args: { input: unknown }, context: GraphQLContext) => {
      const { userId } = await requireAdmin(context);
      return await createGroup(args.input as never, userId);
    },
    updateGroup: async (
      _: unknown,
      args: { id: number; input: unknown },
      context: GraphQLContext,
    ) => {
      const { userId } = await requireAdmin(context);
      return await updateGroup(args.id, args.input as never, userId);
    },
    deleteGroup: async (_: unknown, args: { id: number }, context: GraphQLContext) => {
      const { userId } = await requireAdmin(context);
      await deleteGroup(args.id, userId);
      return true;
    },
    addGroupMember: async (
      _: unknown,
      args: { groupId: number; userId: number },
      context: GraphQLContext,
    ) => {
      const { userId } = await requireAdmin(context);
      await addGroupMember(args.groupId, args.userId, userId);
      return true;
    },
    removeGroupMember: async (
      _: unknown,
      args: { groupId: number; userId: number },
      context: GraphQLContext,
    ) => {
      const { userId } = await requireAdmin(context);
      await removeGroupMember(args.groupId, args.userId, userId);
      return true;
    },

    updateUser: async (
      _: unknown,
      args: { id: number; input: { role?: string } },
      context: GraphQLContext,
    ) => {
      await requireAdmin(context);
      if (args.input.role) await updateUserRole(args.id, args.input.role as never);
      const row = await getUserById(args.id);
      if (!row) throw new Error("User not found");
      return projectUser(row);
    },
    deleteUser: async (_: unknown, args: { id: number }, context: GraphQLContext) => {
      await requireAdmin(context);
      await deleteUser(args.id);
      return true;
    },

    createApiToken: async (
      _: unknown,
      args: { input: { name: string; expiresAt?: string | null } },
      context: GraphQLContext,
    ) => {
      const viewer = await context.viewer();
      const created = await createApiToken(
        args.input.name,
        viewer.userId,
        args.input.expiresAt ?? undefined,
      );
      // The only time the secret is ever readable. Named `secret` in the schema because
      // `rawToken` describes the storage decision rather than what the caller is holding.
      return { token: created.token, secret: created.rawToken };
    },
    deleteApiToken: async (_: unknown, args: { id: number }, context: GraphQLContext) => {
      const viewer = await context.viewer();
      await deleteApiToken(args.id, viewer.userId);
      return true;
    },

    saveSettings: async (
      _: unknown,
      args: { group: string; input: unknown },
      context: GraphQLContext,
    ) => {
      await requireAdmin(context);
      // The same validator the REST route uses, so a value refused there is refused here.
      const validated = validateSettingsGroup(args.group, args.input);
      await setSetting(args.group, validated);
      return validated;
    },

    applyCaddyConfig: async (_: unknown, __: unknown, context: GraphQLContext) => {
      await requireAdmin(context);
      await applyCaddy();
      return true;
    },
  },
};
