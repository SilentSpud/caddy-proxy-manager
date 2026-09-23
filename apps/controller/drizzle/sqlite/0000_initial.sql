CREATE TABLE `access_list_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`accessListId` integer NOT NULL,
	`username` text NOT NULL,
	`passwordHash` text NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`accessListId`) REFERENCES `access_lists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `access_list_entries_list_idx` ON `access_list_entries` (`accessListId`);--> statement-breakpoint
CREATE TABLE `access_lists` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`createdBy` integer,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`userId` integer NOT NULL,
	`accountId` text NOT NULL,
	`providerId` text NOT NULL,
	`accessToken` text,
	`refreshToken` text,
	`idToken` text,
	`accessTokenExpiresAt` text,
	`refreshTokenExpiresAt` text,
	`scope` text,
	`password` text,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_provider_account_idx` ON `accounts` (`providerId`,`accountId`);--> statement-breakpoint
CREATE INDEX `accounts_user_idx` ON `accounts` (`userId`);--> statement-breakpoint
CREATE TABLE `agents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`agentId` text NOT NULL,
	`secret` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`buildSettings` text,
	`lastSeenAt` text,
	`lastError` text,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agents_agentId_unique` ON `agents` (`agentId`);--> statement-breakpoint
CREATE TABLE `api_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`tokenHash` text NOT NULL,
	`createdBy` integer NOT NULL,
	`createdAt` text NOT NULL,
	`lastUsedAt` text,
	`expiresAt` text,
	FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_tokens_token_hash_unique` ON `api_tokens` (`tokenHash`);--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`userId` integer,
	`action` text NOT NULL,
	`entityType` text NOT NULL,
	`entityId` integer,
	`summary` text,
	`data` text,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `ca_certificates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`certificatePem` text NOT NULL,
	`privateKeyPem` text,
	`createdBy` integer,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `certificates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`domainNames` text NOT NULL,
	`autoRenew` integer DEFAULT true NOT NULL,
	`providerOptions` text,
	`certificatePem` text,
	`privateKeyPem` text,
	`createdBy` integer,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `forward_auth_access` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`proxyHostId` integer NOT NULL,
	`userId` integer,
	`groupId` integer,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`proxyHostId`) REFERENCES `proxy_hosts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`groupId`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `faa_host_idx` ON `forward_auth_access` (`proxyHostId`);--> statement-breakpoint
CREATE UNIQUE INDEX `faa_user_unique` ON `forward_auth_access` (`proxyHostId`,`userId`);--> statement-breakpoint
CREATE UNIQUE INDEX `faa_group_unique` ON `forward_auth_access` (`proxyHostId`,`groupId`);--> statement-breakpoint
CREATE TABLE `forward_auth_exchanges` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sessionId` integer NOT NULL,
	`proxyHostId` integer NOT NULL,
	`audienceOrigin` text NOT NULL,
	`codeHash` text NOT NULL,
	`sessionToken` text NOT NULL,
	`redirectUri` text NOT NULL,
	`expiresAt` text NOT NULL,
	`used` integer DEFAULT false NOT NULL,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`sessionId`) REFERENCES `forward_auth_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`proxyHostId`) REFERENCES `proxy_hosts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fae_code_hash_unique` ON `forward_auth_exchanges` (`codeHash`);--> statement-breakpoint
CREATE TABLE `forward_auth_redirect_intents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ridHash` text NOT NULL,
	`proxyHostId` integer NOT NULL,
	`audienceOrigin` text NOT NULL,
	`redirectUri` text NOT NULL,
	`expiresAt` text NOT NULL,
	`consumed` integer DEFAULT false NOT NULL,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`proxyHostId`) REFERENCES `proxy_hosts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fari_rid_hash_unique` ON `forward_auth_redirect_intents` (`ridHash`);--> statement-breakpoint
CREATE INDEX `fari_expires_idx` ON `forward_auth_redirect_intents` (`expiresAt`);--> statement-breakpoint
CREATE TABLE `forward_auth_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`userId` integer NOT NULL,
	`proxyHostId` integer NOT NULL,
	`audienceOrigin` text NOT NULL,
	`tokenHash` text NOT NULL,
	`expiresAt` text NOT NULL,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`proxyHostId`) REFERENCES `proxy_hosts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fas_token_hash_unique` ON `forward_auth_sessions` (`tokenHash`);--> statement-breakpoint
CREATE INDEX `fas_user_idx` ON `forward_auth_sessions` (`userId`);--> statement-breakpoint
CREATE INDEX `fas_proxy_host_idx` ON `forward_auth_sessions` (`proxyHostId`);--> statement-breakpoint
CREATE INDEX `fas_expires_idx` ON `forward_auth_sessions` (`expiresAt`);--> statement-breakpoint
CREATE TABLE `group_grants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`groupId` integer NOT NULL,
	`proxyHostId` integer,
	`l4ProxyHostId` integer,
	`agentId` integer,
	`capability` text DEFAULT 'manage' NOT NULL,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`groupId`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`proxyHostId`) REFERENCES `proxy_hosts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`l4ProxyHostId`) REFERENCES `l4_proxy_hosts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agentId`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `group_grants_group_idx` ON `group_grants` (`groupId`);--> statement-breakpoint
CREATE UNIQUE INDEX `group_grants_proxy_host_unique` ON `group_grants` (`groupId`,`proxyHostId`);--> statement-breakpoint
CREATE UNIQUE INDEX `group_grants_l4_host_unique` ON `group_grants` (`groupId`,`l4ProxyHostId`);--> statement-breakpoint
CREATE UNIQUE INDEX `group_grants_agent_unique` ON `group_grants` (`groupId`,`agentId`);--> statement-breakpoint
CREATE TABLE `group_idp_mappings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`groupId` integer NOT NULL,
	`providerId` text,
	`externalName` text NOT NULL,
	`externalKey` text NOT NULL,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`groupId`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`providerId`) REFERENCES `oauth_providers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `group_idp_mappings_group_idx` ON `group_idp_mappings` (`groupId`);--> statement-breakpoint
CREATE INDEX `group_idp_mappings_key_idx` ON `group_idp_mappings` (`externalKey`);--> statement-breakpoint
CREATE TABLE `group_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`groupId` integer NOT NULL,
	`userId` integer NOT NULL,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`groupId`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `group_members_unique` ON `group_members` (`groupId`,`userId`);--> statement-breakpoint
CREATE INDEX `group_members_user_idx` ON `group_members` (`userId`);--> statement-breakpoint
CREATE TABLE `groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`createdBy` integer,
	`source` text DEFAULT 'ui' NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `groups_name_unique` ON `groups` (`name`);--> statement-breakpoint
CREATE TABLE `issued_client_certificates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`caCertificateId` integer NOT NULL,
	`commonName` text NOT NULL,
	`serialNumber` text NOT NULL,
	`fingerprintSha256` text NOT NULL,
	`certificatePem` text NOT NULL,
	`validFrom` text NOT NULL,
	`validTo` text NOT NULL,
	`revokedAt` text,
	`createdBy` integer,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`caCertificateId`) REFERENCES `ca_certificates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `issued_client_certificates_ca_idx` ON `issued_client_certificates` (`caCertificateId`);--> statement-breakpoint
CREATE INDEX `issued_client_certificates_revoked_at_idx` ON `issued_client_certificates` (`revokedAt`);--> statement-breakpoint
CREATE TABLE `l4_proxy_host_agents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`l4ProxyHostId` integer NOT NULL,
	`agentId` integer NOT NULL,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`l4ProxyHostId`) REFERENCES `l4_proxy_hosts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agentId`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `l4_proxy_host_agents_unique` ON `l4_proxy_host_agents` (`l4ProxyHostId`,`agentId`);--> statement-breakpoint
CREATE INDEX `l4_proxy_host_agents_agent_idx` ON `l4_proxy_host_agents` (`agentId`);--> statement-breakpoint
CREATE TABLE `l4_proxy_hosts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`protocol` text NOT NULL,
	`listenAddress` text NOT NULL,
	`upstreams` text NOT NULL,
	`matcherType` text DEFAULT 'none' NOT NULL,
	`matcherValue` text,
	`tlsTermination` integer DEFAULT false NOT NULL,
	`proxyProtocolVersion` text,
	`proxyProtocolReceive` integer DEFAULT false NOT NULL,
	`ownerUserId` integer,
	`meta` text,
	`enabled` integer DEFAULT true NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`ownerUserId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `mtls_access_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`proxyHostId` integer NOT NULL,
	`pathPattern` text NOT NULL,
	`allowedRoleIds` text DEFAULT '[]' NOT NULL,
	`allowedCertIds` text DEFAULT '[]' NOT NULL,
	`denyAll` integer DEFAULT false NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`description` text,
	`createdBy` integer,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`proxyHostId`) REFERENCES `proxy_hosts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `mtls_access_rules_proxy_host_idx` ON `mtls_access_rules` (`proxyHostId`);--> statement-breakpoint
CREATE UNIQUE INDEX `mtls_access_rules_host_path_unique` ON `mtls_access_rules` (`proxyHostId`,`pathPattern`);--> statement-breakpoint
CREATE TABLE `mtls_certificate_roles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`issuedClientCertificateId` integer NOT NULL,
	`mtlsRoleId` integer NOT NULL,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`issuedClientCertificateId`) REFERENCES `issued_client_certificates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mtlsRoleId`) REFERENCES `mtls_roles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mtls_cert_role_unique` ON `mtls_certificate_roles` (`issuedClientCertificateId`,`mtlsRoleId`);--> statement-breakpoint
CREATE INDEX `mtls_certificate_roles_role_idx` ON `mtls_certificate_roles` (`mtlsRoleId`);--> statement-breakpoint
CREATE TABLE `mtls_roles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`createdBy` integer,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mtls_roles_name_unique` ON `mtls_roles` (`name`);--> statement-breakpoint
CREATE TABLE `oauth_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text DEFAULT 'oidc' NOT NULL,
	`clientId` text NOT NULL,
	`clientSecret` text NOT NULL,
	`issuer` text,
	`authorizationUrl` text,
	`tokenUrl` text,
	`userinfoUrl` text,
	`scopes` text DEFAULT 'openid email profile' NOT NULL,
	`autoLink` integer DEFAULT false NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`source` text DEFAULT 'ui' NOT NULL,
	`groupsClaim` text DEFAULT 'groups' NOT NULL,
	`groupPrefix` text,
	`roleMappingEnabled` integer DEFAULT false NOT NULL,
	`adminGroup` text,
	`operatorGroup` text,
	`userGroup` text,
	`viewerGroup` text,
	`defaultRole` text DEFAULT 'user' NOT NULL,
	`syncGroups` integer DEFAULT false NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_providers_name_unique` ON `oauth_providers` (`name`);--> statement-breakpoint
CREATE TABLE `oauth_states` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`state` text NOT NULL,
	`codeVerifier` text NOT NULL,
	`redirectTo` text,
	`createdAt` text NOT NULL,
	`expiresAt` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_state_unique` ON `oauth_states` (`state`);--> statement-breakpoint
CREATE TABLE `pending_oauth_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`userId` integer NOT NULL,
	`provider` text(50) NOT NULL,
	`userEmail` text NOT NULL,
	`createdAt` text NOT NULL,
	`expiresAt` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pending_oauth_user_provider_unique` ON `pending_oauth_links` (`userId`,`provider`);--> statement-breakpoint
CREATE TABLE `proxy_host_agents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`proxyHostId` integer NOT NULL,
	`agentId` integer NOT NULL,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`proxyHostId`) REFERENCES `proxy_hosts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agentId`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `proxy_host_agents_unique` ON `proxy_host_agents` (`proxyHostId`,`agentId`);--> statement-breakpoint
CREATE INDEX `proxy_host_agents_agent_idx` ON `proxy_host_agents` (`agentId`);--> statement-breakpoint
CREATE TABLE `proxy_hosts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`domains` text NOT NULL,
	`upstreams` text NOT NULL,
	`certificateId` integer,
	`accessListId` integer,
	`ownerUserId` integer,
	`sslForced` integer DEFAULT true NOT NULL,
	`hstsEnabled` integer DEFAULT true NOT NULL,
	`hstsSubdomains` integer DEFAULT false NOT NULL,
	`allowWebsocket` integer DEFAULT true NOT NULL,
	`preserveHostHeader` integer DEFAULT true NOT NULL,
	`meta` text,
	`enabled` integer DEFAULT true NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	`skipHttpsHostnameValidation` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`certificateId`) REFERENCES `certificates`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`accessListId`) REFERENCES `access_lists`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`ownerUserId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`userId` integer NOT NULL,
	`token` text NOT NULL,
	`expiresAt` text NOT NULL,
	`ipAddress` text,
	`userAgent` text,
	`oidcProviderId` text,
	`oidcSid` text,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_unique` ON `sessions` (`token`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`userId`);--> statement-breakpoint
CREATE INDEX `sessions_oidc_session_idx` ON `sessions` (`oidcProviderId`,`oidcSid`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings_revisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`appliedBy` integer,
	`appliedByName` text,
	`summary` text NOT NULL,
	`keys` text NOT NULL,
	`outcome` text NOT NULL,
	`error` text,
	`appliedAt` text NOT NULL,
	FOREIGN KEY (`appliedBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `settings_staged` (
	`key` text NOT NULL,
	`userId` integer NOT NULL,
	`value` text NOT NULL,
	`stagedAt` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `settings_staged_user_key_idx` ON `settings_staged` (`userId`,`key`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`passwordHash` text,
	`passwordChangedAt` text,
	`role` text DEFAULT 'user' NOT NULL,
	`provider` text,
	`subject` text,
	`avatarUrl` text,
	`status` text DEFAULT 'active' NOT NULL,
	`username` text,
	`displayUsername` text,
	`emailVerified` integer DEFAULT false NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `verifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expiresAt` text NOT NULL,
	`createdAt` text,
	`updatedAt` text
);
