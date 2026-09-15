/**
 * Puts a stored audit summary into the reader's language.
 *
 * Summaries are written once, in English, by whoever logs the event, and `/api/v1/audit-log`
 * returns them as stored - that response is a machine contract. So the row stays English and the
 * translation happens at render time: each summary shape the app writes is read back into its
 * parameters here and rendered from `auditLog.summaries.*`. A summary nothing here recognises - a
 * new call site, a row migrated from an older version - is shown as it was stored.
 *
 * The patterns mirror the template literals at the `logAuditEvent` and `createAuditEvent` call
 * sites, looked up by entity type and action, and the first that matches wins. The message keys
 * are composed at runtime, so `tests/unit/audit-summary-messages.test.ts` renders every one from
 * the English catalog and checks its pattern reads the same values back: a pattern without a
 * message, or a message that no longer reproduces the stored English, fails there.
 */

import type { useTranslations } from "next-intl";

type Translator = ReturnType<typeof useTranslations>;

/** The one place the narrowing is given up, for the reason in the header comment. */
type DynamicTranslate = (key: string, values?: Record<string, string>) => string;

export type AuditSummaryPattern = {
  entityType: string;
  action: string;
  /** The message's key under `auditLog.summaries`. */
  message: string;
  /** Anchored; each named group is one of the message's parameters. */
  pattern: RegExp;
};

/**
 * Created / Updated / Deleted `<noun> <name>` - the shape every model with a name logs. Builds a
 * pattern that reads the English back, not a sentence anyone is shown.
 */
function lifecycle(entityType: string, noun: string, messagePrefix: string): AuditSummaryPattern[] {
  return [
    ["create", "Created"],
    ["update", "Updated"],
    ["delete", "Deleted"],
  ].map(([action, verb]) => ({
    entityType,
    action,
    message: `${messagePrefix}${verb}`,
    pattern: new RegExp(`^${verb} ${noun} (?<name>.+)$`, "s"),
  }));
}

export const AUDIT_SUMMARY_PATTERNS: readonly AuditSummaryPattern[] = [
  ...lifecycle("proxy_host", "proxy host", "proxyHost"),
  ...lifecycle("l4_proxy_host", "L4 proxy host", "l4ProxyHost"),
  ...lifecycle("certificate", "certificate", "certificate"),
  ...lifecycle("ca_certificate", "CA certificate", "caCertificate"),
  ...lifecycle("mtls_role", "mTLS role", "mtlsRole"),
  ...lifecycle("access_list", "access list", "accessList"),
  ...lifecycle("group", "group", "group"),

  // users/actions.ts
  {
    entityType: "user",
    action: "create",
    message: "userCreated",
    pattern: /^Created user (?<id>.+?) \((?<email>.+)\) with role (?<role>.+)$/s,
  },
  {
    entityType: "user",
    action: "update",
    message: "userRoleChanged",
    pattern: /^Changed user (?<id>.+?) role to (?<role>.+)$/s,
  },
  {
    entityType: "user",
    action: "update",
    message: "userStatusChanged",
    pattern: /^Changed user (?<id>.+?) status to (?<status>.+)$/s,
  },
  {
    entityType: "user",
    action: "update",
    message: "userProfileUpdated",
    pattern: /^Updated user (?<id>.+) profile$/s,
  },
  {
    entityType: "user",
    action: "delete",
    message: "userDeleted",
    pattern: /^Deleted user (?<id>.+)$/s,
  },

  // groups/actions.ts and models/groups.ts
  {
    entityType: "group",
    action: "update",
    message: "groupMappingsUpdated",
    pattern: /^Updated the IdP group mappings for group (?<id>.+)$/s,
  },
  {
    entityType: "group",
    action: "update",
    message: "groupGrantsUpdated",
    pattern: /^Updated the management grants for group (?<id>.+)$/s,
  },
  {
    entityType: "group_member",
    action: "create",
    message: "groupMemberAdded",
    pattern: /^Added user (?<id>.+?) to group (?<group>.+)$/s,
  },
  {
    entityType: "group_member",
    action: "delete",
    message: "groupMemberRemoved",
    pattern: /^Removed user (?<id>.+?) from group (?<group>.+)$/s,
  },

  // models/mtls-roles.ts, mtls-access-rules.ts, issued-client-certificates.ts
  {
    entityType: "mtls_certificate_role",
    action: "assign",
    message: "mtlsCertificateAssigned",
    pattern: /^Assigned cert (?<cert>.+?) to role (?<role>.+)$/s,
  },
  {
    entityType: "mtls_certificate_role",
    action: "unassign",
    message: "mtlsCertificateUnassigned",
    pattern: /^Removed cert from role (?<role>.+)$/s,
  },
  {
    entityType: "mtls_access_rule",
    action: "create",
    message: "mtlsAccessRuleCreated",
    pattern: /^Created mTLS access rule for path (?<path>.+?) on proxy host (?<hostId>.+)$/s,
  },
  {
    entityType: "mtls_access_rule",
    action: "update",
    message: "mtlsAccessRuleUpdated",
    pattern: /^Updated mTLS access rule for path (?<path>.+)$/s,
  },
  {
    entityType: "mtls_access_rule",
    action: "delete",
    message: "mtlsAccessRuleDeleted",
    pattern: /^Deleted mTLS access rule for path (?<path>.+)$/s,
  },
  {
    entityType: "issued_client_certificate",
    action: "create",
    message: "clientCertificateIssued",
    pattern: /^Issued client certificate (?<name>.+)$/s,
  },
  {
    entityType: "issued_client_certificate",
    action: "revoke",
    message: "clientCertificateRevoked",
    pattern: /^Revoked client certificate (?<name>.+)$/s,
  },

  // models/access-lists.ts and models/forward-auth.ts
  {
    entityType: "access_list_entry",
    action: "create",
    message: "accessListEntryAdded",
    pattern: /^Added user (?<username>.+?) to access list (?<list>.+)$/s,
  },
  {
    entityType: "access_list_entry",
    action: "delete",
    message: "accessListEntryRemoved",
    pattern: /^Removed entry from access list (?<list>.+)$/s,
  },
  {
    entityType: "forward_auth_access",
    action: "update",
    message: "forwardAuthAccessUpdated",
    pattern: /^Updated forward auth access for proxy host (?<id>.+)$/s,
  },

  // api/forward-auth/login and session-login
  {
    entityType: "user",
    action: "forward_auth_login_failed",
    message: "forwardAuthLoginFailedUsername",
    pattern: /^Forward auth login failed for username: (?<username>.+)$/s,
  },
  {
    entityType: "user",
    action: "forward_auth_login_failed",
    message: "forwardAuthLoginFailed",
    pattern: /^Forward auth login failed for user (?<email>.+)$/s,
  },
  {
    entityType: "proxy_host",
    action: "forward_auth_access_denied",
    message: "forwardAuthAccessDenied",
    pattern: /^Forward auth access denied for user (?<email>.+?) to host (?<host>.+)$/s,
  },
  {
    entityType: "user",
    action: "forward_auth_login",
    message: "forwardAuthLogin",
    pattern: /^Forward auth login for user (?<email>.+?) to (?<host>.+)$/s,
  },
  {
    entityType: "user",
    action: "forward_auth_login",
    message: "forwardAuthSessionLogin",
    pattern: /^Forward auth login \(session\) for user (?<email>.+?) to (?<host>.+)$/s,
  },

  // services/oidc-logout.ts and oidc-group-sync.ts
  {
    entityType: "user",
    action: "oidc_backchannel_logout",
    message: "oidcBackchannelLogout",
    pattern: /^Sessions for user (?<id>.+?) ended by a back-channel logout from (?<provider>.+)$/s,
  },
  {
    entityType: "user",
    action: "oidc_role_sync_skipped",
    message: "oidcRoleSyncSkipped",
    pattern:
      /^Kept admin role for user (?<id>.+?): (?<provider>.+) groups mapped to "(?<role>.+)" but no other active admin exists$/s,
  },
  {
    entityType: "user",
    action: "oidc_role_sync",
    message: "oidcRoleSync",
    pattern:
      /^Role for user (?<id>.+?) set to "(?<role>.+?)" from (?<provider>.+) groups \(was "(?<previous>.+)"\)$/s,
  },
  // Both halves first: the added-only pattern would otherwise swallow "; removed from ..." as
  // part of the group list.
  {
    entityType: "user",
    action: "oidc_group_sync",
    message: "oidcGroupSyncAddedRemoved",
    pattern:
      /^Group membership for user (?<id>.+?) synced from (?<provider>.+?): added to (?<added>.+?); removed from (?<removed>.+)$/s,
  },
  {
    entityType: "user",
    action: "oidc_group_sync",
    message: "oidcGroupSyncAdded",
    pattern:
      /^Group membership for user (?<id>.+?) synced from (?<provider>.+?): added to (?<added>.+)$/s,
  },
  {
    entityType: "user",
    action: "oidc_group_sync",
    message: "oidcGroupSyncRemoved",
    pattern:
      /^Group membership for user (?<id>.+?) synced from (?<provider>.+?): removed from (?<removed>.+)$/s,
  },

  // lib/setup.ts and lib/auth-server.ts
  {
    entityType: "user",
    action: "setup_first_admin",
    message: "setupFirstAdmin",
    pattern: /^User (?<id>.+) became the first administrator by signing in during setup$/s,
  },
  {
    entityType: "session",
    action: "login_success",
    message: "loginSuccess",
    pattern: /^User signed in$/,
  },

  // settings/actions.ts
  {
    entityType: "oauth_provider",
    action: "oauth_provider_created",
    message: "oauthProviderCreatedFromSettings",
    pattern: /^OAuth provider "(?<name>.+)" created$/s,
  },
  {
    entityType: "oauth_provider",
    action: "oauth_provider_updated",
    message: "oauthProviderMadePrimary",
    pattern: /^Made OAuth provider "(?<id>.+)" primary$/s,
  },
  {
    entityType: "oauth_provider",
    action: "oauth_provider_updated",
    message: "oauthProviderPrimaryCleared",
    pattern: /^Cleared the primary OAuth provider$/,
  },
  {
    entityType: "oauth_provider",
    action: "oauth_provider_updated",
    message: "oauthProviderUpdated",
    pattern: /^Updated OAuth provider "(?<name>.+)"$/s,
  },
  {
    entityType: "oauth_provider",
    action: "oauth_provider_deleted",
    message: "oauthProviderDeleted",
    pattern: /^Deleted OAuth provider "(?<name>.+)"$/s,
  },

  // api/v1/oauth-providers
  {
    entityType: "oauth_provider",
    action: "create",
    message: "oauthProviderCreated",
    pattern: /^Created OAuth provider "(?<name>.+)"$/s,
  },
  {
    entityType: "oauth_provider",
    action: "update",
    message: "oauthProviderUpdated",
    pattern: /^Updated OAuth provider "(?<name>.+)"$/s,
  },
  {
    entityType: "oauth_provider",
    action: "delete",
    message: "oauthProviderDeleted",
    pattern: /^Deleted OAuth provider "(?<name>.+)"$/s,
  },

  // api/user/*
  {
    entityType: "user",
    action: "password_changed",
    message: "passwordChanged",
    pattern: /^User changed their password$/,
  },
  {
    entityType: "user",
    action: "password_set",
    message: "passwordSet",
    pattern: /^User set a password$/,
  },
  {
    entityType: "user",
    action: "password_removed",
    message: "passwordRemoved",
    pattern: /^User removed their password; signs in with (?<providers>.+)$/s,
  },
  {
    entityType: "user",
    action: "oauth_unlinked",
    message: "oauthUnlinked",
    pattern: /^User unlinked OAuth account: (?<provider>.+)$/s,
  },
  {
    entityType: "user",
    action: "avatar_updated",
    message: "avatarUpdated",
    pattern: /^User updated profile picture$/,
  },
  {
    entityType: "user",
    action: "avatar_deleted",
    message: "avatarDeleted",
    pattern: /^User removed profile picture$/,
  },
];

export function matchAuditSummary(event: {
  action: string;
  entityType: string;
  summary: string | null;
}): { message: string; values: Record<string, string> } | null {
  const { summary } = event;
  if (summary === null) return null;
  for (const candidate of AUDIT_SUMMARY_PATTERNS) {
    if (candidate.entityType !== event.entityType || candidate.action !== event.action) continue;
    const match = candidate.pattern.exec(summary);
    if (match) return { message: candidate.message, values: { ...match.groups } };
  }
  return null;
}

/** The summary in the reader's language, the stored one when it is not recognised, or null. */
export function auditSummaryText(
  t: Translator,
  event: { action: string; entityType: string; summary: string | null },
): string | null {
  const match = matchAuditSummary(event);
  if (!match) return event.summary;
  return (t as unknown as DynamicTranslate)(`auditLog.summaries.${match.message}`, match.values);
}
