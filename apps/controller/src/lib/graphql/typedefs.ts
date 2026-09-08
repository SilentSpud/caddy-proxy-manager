/**
 * The schema, as SDL.
 *
 * Two rules decide whether something is a field or a `JSON` blob:
 *
 * - **A field** when the shape is stable and worth querying — an id, a name, a domain list, a
 *   timestamp, a foreign key. These are what a client filters, sorts and displays on.
 * - **`JSON`** when the model layer owns the shape — load-balancer settings, WAF overrides,
 *   geoblock rules, mTLS configuration. Those change with the product and are validated by
 *   functions that already exist; restating them here would be thousands of lines of schema that
 *   can drift out of step with the validator, while looking authoritative.
 *
 * Mutations take the same JSON body the REST route took, and hand it to the same model function.
 * That is deliberate: it is what makes a GraphQL mutation and its `/api/v1/` counterpart provably
 * equivalent, which is what the parity tests assert.
 */

export const typeDefs = /* GraphQL */ `
  scalar JSON
  scalar DateTime

  """
  A reverse proxy host. Configuration the model layer validates travels in \`config\`.
  """
  type ProxyHost {
    id: Int!
    name: String!
    domains: [String!]!
    upstreams: [String!]!
    enabled: Boolean!
    certificateId: Int
    accessListId: Int
    sslForced: Boolean!
    hstsEnabled: Boolean!
    hstsSubdomains: Boolean!
    allowWebsocket: Boolean!
    preserveHostHeader: Boolean!
    skipHttpsHostnameValidation: Boolean!
    createdAt: DateTime!
    updatedAt: DateTime!
    """
    Everything else the host carries: load balancing, health checks, WAF and geoblock overrides,
    location rules, redirects, rewrites, mTLS, Tailscale and forward auth.
    """
    config: JSON
  }

  """A layer 4 (TCP/UDP) stream host."""
  type L4ProxyHost {
    id: Int!
    name: String!
    protocol: String!
    listenAddress: String!
    upstreams: [String!]!
    matcherType: String!
    matcherValue: [String!]!
    tlsTermination: Boolean!
    proxyProtocolVersion: String
    proxyProtocolReceive: Boolean!
    enabled: Boolean!
    createdAt: DateTime!
    updatedAt: DateTime!
    """Load balancing, DNS resolution, geoblocking and anything else the model validates."""
    config: JSON
  }

  """
  A certificate. The PEM bodies and the private key are deliberately absent: they are write-only
  over the REST API too, and a field that returns a private key is a field somebody will select.
  """
  type Certificate {
    id: Int!
    name: String!
    type: String!
    domainNames: [String!]!
    autoRenew: Boolean!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type CaCertificate {
    id: Int!
    name: String!
    createdAt: DateTime!
  }

  type ClientCertificate {
    id: Int!
    name: String!
    caCertificateId: Int!
    revokedAt: DateTime
    createdAt: DateTime!
  }

  type MtlsRole {
    id: Int!
    name: String!
    description: String
    createdAt: DateTime!
  }

  type AccessList {
    id: Int!
    name: String!
    description: String
    entries: [AccessListEntry!]!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  """An account in an access list. The password hash is never exposed."""
  type AccessListEntry {
    username: String!
  }

  """
  A user. The password hash and the OAuth subject are absent by construction — the resolver
  projects the fields below rather than returning the model row, so a field cannot be added here
  by accident and start leaking one.
  """
  type User {
    id: Int!
    email: String!
    name: String
    role: String!
    status: String!
    provider: String
    avatarUrl: String
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type Group {
    id: Int!
    name: String!
    description: String
    """"ui" for a group someone made here, "oidc" for one an IdP sync created."""
    source: String!
    members: [GroupMember!]!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type GroupMember {
    userId: Int!
    email: String!
    name: String
  }

  type ApiToken {
    id: Int!
    name: String!
    createdBy: Int!
    createdAt: DateTime!
    lastUsedAt: DateTime
    expiresAt: DateTime
  }

  """A token is only readable once, when it is created."""
  type CreatedApiToken {
    token: ApiToken!
    secret: String!
  }

  type AuditEvent {
    id: Int!
    userId: Int
    action: String!
    entityType: String!
    entityId: Int
    summary: String
    createdAt: DateTime!
  }

  type Agent {
    id: Int!
    name: String!
    connected: Boolean!
    lastSeenAt: DateTime
    createdAt: DateTime!
  }

  type OAuthProvider {
    id: Int!
    name: String!
    enabled: Boolean!
    issuer: String
  }

  type DnsProvider {
    id: String!
    name: String!
    configured: Boolean!
  }

  """A page of results, with the total so a client can size its pager."""
  type AuditEventPage {
    items: [AuditEvent!]!
    total: Int!
  }

  type Query {
    proxyHosts: [ProxyHost!]!
    proxyHost(id: Int!): ProxyHost
    l4ProxyHosts: [L4ProxyHost!]!
    l4ProxyHost(id: Int!): L4ProxyHost
    certificates: [Certificate!]!
    certificate(id: Int!): Certificate
    caCertificates: [CaCertificate!]!
    clientCertificates: [ClientCertificate!]!
    mtlsRoles: [MtlsRole!]!
    accessLists: [AccessList!]!
    accessList(id: Int!): AccessList
    users: [User!]!
    user(id: Int!): User
    groups: [Group!]!
    group(id: Int!): Group
    apiTokens: [ApiToken!]!
    agents: [Agent!]!
    oauthProviders: [OAuthProvider!]!
    dnsProviders: [DnsProvider!]!
    auditLog(limit: Int, offset: Int, search: String): AuditEventPage!
    """One settings group, e.g. "general" or "dashboard". Shape belongs to the group."""
    settings(group: String!): JSON
    """The Caddy modules compiled into the running binary."""
    caddyModules: JSON
  }

  type Mutation {
    createProxyHost(input: JSON!): ProxyHost!
    updateProxyHost(id: Int!, input: JSON!): ProxyHost!
    deleteProxyHost(id: Int!): Boolean!

    createL4ProxyHost(input: JSON!): L4ProxyHost!
    updateL4ProxyHost(id: Int!, input: JSON!): L4ProxyHost!
    deleteL4ProxyHost(id: Int!): Boolean!

    createAccessList(input: JSON!): AccessList!
    updateAccessList(id: Int!, input: JSON!): AccessList!
    deleteAccessList(id: Int!): Boolean!

    createGroup(input: JSON!): Group!
    updateGroup(id: Int!, input: JSON!): Group!
    deleteGroup(id: Int!): Boolean!
    addGroupMember(groupId: Int!, userId: Int!): Boolean!
    removeGroupMember(groupId: Int!, userId: Int!): Boolean!

    updateUser(id: Int!, input: JSON!): User!
    deleteUser(id: Int!): Boolean!

    createApiToken(input: JSON!): CreatedApiToken!
    deleteApiToken(id: Int!): Boolean!

    saveSettings(group: String!, input: JSON!): JSON!

    """Rebuild and push the Caddy configuration to every agent. All of them, or none."""
    applyCaddyConfig: Boolean!

    """
    What this agent currently has applied. Requires a signed agent, not a user token.
    Refused when the agent has no open subscription: a status from an unreachable host would
    make the dashboard claim it is reachable.
    """
    agentStatus(status: JSON!): Boolean!

    """Results for the Caddy admin calls the controller is blocked on. Signed agents only."""
    agentCommandResults(results: [JSON!]!): Boolean!
  }

  """
  The controller's half of the agent conversation.

  One long-lived subscription per agent, carrying desired state, commands, an opening hello and a
  periodic ping. Delivered over SSE, which is what the agent already spoke — the difference is
  that the framing now belongs to the GraphQL server rather than to the registry.
  """
  type Subscription {
    agentEvents: JSON!
  }
`;
