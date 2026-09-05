/**
 * What a migration is allowed to bring across, expressed as things an operator recognises.
 *
 * The importer works in tables; nobody upgrading thinks in tables. So the schema's thirty-odd
 * names are gathered into eight groups, each of which is a thing someone would actually decide
 * about — "bring my proxy hosts, leave the old accounts behind".
 *
 * Two rules keep a partial selection from quietly producing a broken or less-safe database:
 *
 * 1. **`requires`.** A proxy host points at a certificate and an access list, and both references
 *    are nullable — so importing hosts without them would succeed and silently publish a host
 *    that used to sit behind a password. Those groups come along whether or not they were ticked.
 * 2. **Everything else is nulled or dropped by the importer**, from the foreign keys themselves
 *    rather than from a list here. The remaining cross-group references are `createdBy`,
 *    `ownerUserId` and `audit_events.userId` — provenance that nothing authorises against, so a
 *    row that loses it is still the row it was.
 */

export type MigrationGroupId =
  | "users"
  | "proxyHosts"
  | "certificates"
  | "accessLists"
  | "oauthProviders"
  | "agents"
  | "settings"
  | "auditLog";

export type MigrationGroup = {
  id: MigrationGroupId;
  /** What the setup page calls it. */
  label: string;
  /** One sentence on what is and is not in it, shown under the label. */
  description: string;
  /** The schema table names — the `pgTable` name, not the exported identifier. */
  tables: string[];
  /** Groups that cannot be left behind when this one is taken. */
  requires: MigrationGroupId[];
};

/** In the order the setup page offers them: the consequential choices first. */
export const MIGRATION_GROUPS: MigrationGroup[] = [
  {
    id: "users",
    label: "Users and their sign-in",
    description:
      "Accounts, passwords, API tokens, groups and the per-user access rules on your hosts. " +
      "Leaving these behind means creating a new administrator on the next screen.",
    tables: [
      "users",
      "sessions",
      "accounts",
      "verifications",
      "pending_oauth_links",
      "api_tokens",
      "groups",
      "group_members",
      "forward_auth_access",
      "forward_auth_sessions",
      "forward_auth_exchanges",
    ],
    requires: [],
  },
  {
    id: "proxyHosts",
    label: "Proxy hosts",
    description:
      "Your HTTP and layer-4 hosts, with their mTLS access rules. Certificates and access lists " +
      "come with them, because a host that lost its access list would be published unprotected.",
    tables: ["proxy_hosts", "l4_proxy_hosts", "mtls_access_rules", "forward_auth_redirect_intents"],
    requires: ["certificates", "accessLists"],
  },
  {
    id: "certificates",
    label: "Certificates",
    description:
      "Issued and uploaded certificates, certificate authorities, client certificates and mTLS " +
      "roles.",
    tables: [
      "certificates",
      "ca_certificates",
      "issued_client_certificates",
      "mtls_roles",
      "mtls_certificate_roles",
    ],
    requires: [],
  },
  {
    id: "accessLists",
    label: "Access lists",
    description: "Basic-auth lists and the usernames in them.",
    tables: ["access_lists", "access_list_entries"],
    requires: [],
  },
  {
    id: "oauthProviders",
    label: "OAuth providers",
    description:
      "Configured identity providers, including their client secrets. Bringing an enabled " +
      "provider across is a way in on its own, even without the old user accounts.",
    tables: ["oauth_providers", "oauth_states"],
    requires: [],
  },
  {
    id: "agents",
    label: "Agents",
    description: "Remote agents this controller had paired with, and their shared secrets.",
    tables: ["agents", "linking_tokens"],
    requires: [],
  },
  {
    id: "settings",
    label: "Settings",
    description:
      "The stored configuration the Settings page writes — primary domain, ACME details, and the " +
      "rest.",
    tables: ["settings"],
    requires: [],
  },
  {
    id: "auditLog",
    label: "Audit log",
    description:
      "The history of who changed what. Usually the largest table, and never load-bearing.",
    tables: ["audit_events"],
    requires: [],
  },
];

export const ALL_MIGRATION_GROUP_IDS: MigrationGroupId[] = MIGRATION_GROUPS.map(
  (group) => group.id,
);

const BY_ID = new Map(MIGRATION_GROUPS.map((group) => [group.id, group]));

/** The group a table belongs to, or null for one no group claims. */
export function groupForTable(table: string): MigrationGroup | null {
  return MIGRATION_GROUPS.find((group) => group.tables.includes(table)) ?? null;
}

export function isMigrationGroupId(value: string): value is MigrationGroupId {
  return BY_ID.has(value as MigrationGroupId);
}

/**
 * Add every group the chosen ones depend on.
 *
 * Applied on both sides: the checkboxes tick the dependency so the operator sees what they are
 * getting, and the action closes it again because the form is a posted list of strings and cannot
 * be trusted to have done so.
 */
export function withRequiredGroups(ids: Iterable<MigrationGroupId>): MigrationGroupId[] {
  const resolved = new Set<MigrationGroupId>();

  function add(id: MigrationGroupId): void {
    if (resolved.has(id)) return;
    resolved.add(id);
    for (const required of BY_ID.get(id)?.requires ?? []) add(required);
  }

  for (const id of ids) add(id);
  // Declaration order rather than the order they were ticked, so reports and tests are stable.
  return ALL_MIGRATION_GROUP_IDS.filter((id) => resolved.has(id));
}

/** Read a posted `groups` list into a selection: unknown values dropped, dependencies added. */
export function parseMigrationSelection(values: Iterable<string>): MigrationGroupId[] {
  return withRequiredGroups([...values].filter(isMigrationGroupId));
}

/** Every table the selection covers, after dependencies are added. */
export function tablesForSelection(ids: Iterable<MigrationGroupId>): Set<string> {
  const tables = new Set<string>();
  for (const id of withRequiredGroups(ids)) {
    for (const table of BY_ID.get(id)?.tables ?? []) tables.add(table);
  }
  return tables;
}
