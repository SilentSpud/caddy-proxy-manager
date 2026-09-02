CREATE TABLE "access_list_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"accessListId" integer NOT NULL,
	"username" text NOT NULL,
	"passwordHash" text NOT NULL,
	"createdAt" text NOT NULL,
	"updatedAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "access_lists" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"createdBy" integer,
	"createdAt" text NOT NULL,
	"updatedAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"accountId" text NOT NULL,
	"providerId" text NOT NULL,
	"issuer" text NOT NULL,
	"accessToken" text,
	"refreshToken" text,
	"idToken" text,
	"accessTokenExpiresAt" text,
	"refreshTokenExpiresAt" text,
	"scope" text,
	"password" text,
	"createdAt" text NOT NULL,
	"updatedAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"tokenHash" text NOT NULL,
	"createdBy" integer NOT NULL,
	"createdAt" text NOT NULL,
	"lastUsedAt" text,
	"expiresAt" text
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer,
	"action" text NOT NULL,
	"entityType" text NOT NULL,
	"entityId" integer,
	"summary" text,
	"data" text,
	"createdAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ca_certificates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"certificatePem" text NOT NULL,
	"privateKeyPem" text,
	"createdBy" integer,
	"createdAt" text NOT NULL,
	"updatedAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "certificates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"domainNames" text NOT NULL,
	"autoRenew" boolean DEFAULT true NOT NULL,
	"providerOptions" text,
	"certificatePem" text,
	"privateKeyPem" text,
	"createdBy" integer,
	"createdAt" text NOT NULL,
	"updatedAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forward_auth_access" (
	"id" serial PRIMARY KEY NOT NULL,
	"proxyHostId" integer NOT NULL,
	"userId" integer,
	"groupId" integer,
	"createdAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forward_auth_exchanges" (
	"id" serial PRIMARY KEY NOT NULL,
	"sessionId" integer NOT NULL,
	"proxyHostId" integer NOT NULL,
	"audienceOrigin" text NOT NULL,
	"codeHash" text NOT NULL,
	"sessionToken" text NOT NULL,
	"redirectUri" text NOT NULL,
	"expiresAt" text NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"createdAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forward_auth_redirect_intents" (
	"id" serial PRIMARY KEY NOT NULL,
	"ridHash" text NOT NULL,
	"proxyHostId" integer NOT NULL,
	"audienceOrigin" text NOT NULL,
	"redirectUri" text NOT NULL,
	"expiresAt" text NOT NULL,
	"consumed" boolean DEFAULT false NOT NULL,
	"createdAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forward_auth_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"proxyHostId" integer NOT NULL,
	"audienceOrigin" text NOT NULL,
	"tokenHash" text NOT NULL,
	"expiresAt" text NOT NULL,
	"createdAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"groupId" integer NOT NULL,
	"userId" integer NOT NULL,
	"createdAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"createdBy" integer,
	"source" text DEFAULT 'ui' NOT NULL,
	"createdAt" text NOT NULL,
	"updatedAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instances" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"baseUrl" text NOT NULL,
	"apiToken" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"lastSyncAt" text,
	"lastSyncError" text,
	"createdAt" text NOT NULL,
	"updatedAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issued_client_certificates" (
	"id" serial PRIMARY KEY NOT NULL,
	"caCertificateId" integer NOT NULL,
	"commonName" text NOT NULL,
	"serialNumber" text NOT NULL,
	"fingerprintSha256" text NOT NULL,
	"certificatePem" text NOT NULL,
	"validFrom" text NOT NULL,
	"validTo" text NOT NULL,
	"revokedAt" text,
	"createdBy" integer,
	"createdAt" text NOT NULL,
	"updatedAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "l4_proxy_hosts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"protocol" text NOT NULL,
	"listenAddress" text NOT NULL,
	"upstreams" text NOT NULL,
	"matcherType" text DEFAULT 'none' NOT NULL,
	"matcherValue" text,
	"tlsTermination" boolean DEFAULT false NOT NULL,
	"proxyProtocolVersion" text,
	"proxyProtocolReceive" boolean DEFAULT false NOT NULL,
	"ownerUserId" integer,
	"meta" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"createdAt" text NOT NULL,
	"updatedAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "linking_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"createdAt" text NOT NULL,
	"expiresAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "log_parse_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mtls_access_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"proxyHostId" integer NOT NULL,
	"pathPattern" text NOT NULL,
	"allowedRoleIds" text DEFAULT '[]' NOT NULL,
	"allowedCertIds" text DEFAULT '[]' NOT NULL,
	"denyAll" boolean DEFAULT false NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"description" text,
	"createdBy" integer,
	"createdAt" text NOT NULL,
	"updatedAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mtls_certificate_roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"issuedClientCertificateId" integer NOT NULL,
	"mtlsRoleId" integer NOT NULL,
	"createdAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mtls_roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"createdBy" integer,
	"createdAt" text NOT NULL,
	"updatedAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_providers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'oidc' NOT NULL,
	"clientId" text NOT NULL,
	"clientSecret" text NOT NULL,
	"issuer" text,
	"authorizationUrl" text,
	"tokenUrl" text,
	"userinfoUrl" text,
	"scopes" text DEFAULT 'openid email profile' NOT NULL,
	"autoLink" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"source" text DEFAULT 'ui' NOT NULL,
	"groupsClaim" text DEFAULT 'groups' NOT NULL,
	"groupPrefix" text,
	"roleMappingEnabled" boolean DEFAULT false NOT NULL,
	"adminGroup" text,
	"userGroup" text,
	"viewerGroup" text,
	"defaultRole" text DEFAULT 'user' NOT NULL,
	"syncGroups" boolean DEFAULT false NOT NULL,
	"createdAt" text NOT NULL,
	"updatedAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_states" (
	"id" serial PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"codeVerifier" text NOT NULL,
	"redirectTo" text,
	"createdAt" text NOT NULL,
	"expiresAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pending_oauth_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"provider" varchar(50) NOT NULL,
	"userEmail" text NOT NULL,
	"createdAt" text NOT NULL,
	"expiresAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proxy_hosts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"domains" text NOT NULL,
	"upstreams" text NOT NULL,
	"certificateId" integer,
	"accessListId" integer,
	"ownerUserId" integer,
	"sslForced" boolean DEFAULT true NOT NULL,
	"hstsEnabled" boolean DEFAULT true NOT NULL,
	"hstsSubdomains" boolean DEFAULT false NOT NULL,
	"allowWebsocket" boolean DEFAULT true NOT NULL,
	"preserveHostHeader" boolean DEFAULT true NOT NULL,
	"meta" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"createdAt" text NOT NULL,
	"updatedAt" text NOT NULL,
	"skipHttpsHostnameValidation" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"token" text NOT NULL,
	"expiresAt" text NOT NULL,
	"ipAddress" text,
	"userAgent" text,
	"createdAt" text NOT NULL,
	"updatedAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updatedAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"passwordHash" text,
	"role" text DEFAULT 'user' NOT NULL,
	"provider" text,
	"subject" text,
	"avatarUrl" text,
	"status" text DEFAULT 'active' NOT NULL,
	"username" text,
	"displayUsername" text,
	"emailVerified" boolean DEFAULT false NOT NULL,
	"createdAt" text NOT NULL,
	"updatedAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" text NOT NULL,
	"createdAt" text,
	"updatedAt" text
);
--> statement-breakpoint
CREATE TABLE "waf_log_parse_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "access_list_entries" ADD CONSTRAINT "access_list_entries_accessListId_access_lists_id_fk" FOREIGN KEY ("accessListId") REFERENCES "public"."access_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_lists" ADD CONSTRAINT "access_lists_createdBy_users_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_createdBy_users_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ca_certificates" ADD CONSTRAINT "ca_certificates_createdBy_users_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_createdBy_users_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forward_auth_access" ADD CONSTRAINT "forward_auth_access_proxyHostId_proxy_hosts_id_fk" FOREIGN KEY ("proxyHostId") REFERENCES "public"."proxy_hosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forward_auth_access" ADD CONSTRAINT "forward_auth_access_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forward_auth_access" ADD CONSTRAINT "forward_auth_access_groupId_groups_id_fk" FOREIGN KEY ("groupId") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forward_auth_exchanges" ADD CONSTRAINT "forward_auth_exchanges_sessionId_forward_auth_sessions_id_fk" FOREIGN KEY ("sessionId") REFERENCES "public"."forward_auth_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forward_auth_exchanges" ADD CONSTRAINT "forward_auth_exchanges_proxyHostId_proxy_hosts_id_fk" FOREIGN KEY ("proxyHostId") REFERENCES "public"."proxy_hosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forward_auth_redirect_intents" ADD CONSTRAINT "forward_auth_redirect_intents_proxyHostId_proxy_hosts_id_fk" FOREIGN KEY ("proxyHostId") REFERENCES "public"."proxy_hosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forward_auth_sessions" ADD CONSTRAINT "forward_auth_sessions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forward_auth_sessions" ADD CONSTRAINT "forward_auth_sessions_proxyHostId_proxy_hosts_id_fk" FOREIGN KEY ("proxyHostId") REFERENCES "public"."proxy_hosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_groupId_groups_id_fk" FOREIGN KEY ("groupId") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_createdBy_users_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issued_client_certificates" ADD CONSTRAINT "issued_client_certificates_caCertificateId_ca_certificates_id_fk" FOREIGN KEY ("caCertificateId") REFERENCES "public"."ca_certificates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issued_client_certificates" ADD CONSTRAINT "issued_client_certificates_createdBy_users_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "l4_proxy_hosts" ADD CONSTRAINT "l4_proxy_hosts_ownerUserId_users_id_fk" FOREIGN KEY ("ownerUserId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mtls_access_rules" ADD CONSTRAINT "mtls_access_rules_proxyHostId_proxy_hosts_id_fk" FOREIGN KEY ("proxyHostId") REFERENCES "public"."proxy_hosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mtls_access_rules" ADD CONSTRAINT "mtls_access_rules_createdBy_users_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mtls_certificate_roles" ADD CONSTRAINT "mtls_certificate_roles_issuedClientCertificateId_issued_client_certificates_id_fk" FOREIGN KEY ("issuedClientCertificateId") REFERENCES "public"."issued_client_certificates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mtls_certificate_roles" ADD CONSTRAINT "mtls_certificate_roles_mtlsRoleId_mtls_roles_id_fk" FOREIGN KEY ("mtlsRoleId") REFERENCES "public"."mtls_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mtls_roles" ADD CONSTRAINT "mtls_roles_createdBy_users_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_oauth_links" ADD CONSTRAINT "pending_oauth_links_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proxy_hosts" ADD CONSTRAINT "proxy_hosts_certificateId_certificates_id_fk" FOREIGN KEY ("certificateId") REFERENCES "public"."certificates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proxy_hosts" ADD CONSTRAINT "proxy_hosts_accessListId_access_lists_id_fk" FOREIGN KEY ("accessListId") REFERENCES "public"."access_lists"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proxy_hosts" ADD CONSTRAINT "proxy_hosts_ownerUserId_users_id_fk" FOREIGN KEY ("ownerUserId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_list_entries_list_idx" ON "access_list_entries" USING btree ("accessListId");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_provider_account_idx" ON "accounts" USING btree ("providerId","accountId");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_issuer_account_idx" ON "accounts" USING btree ("issuer","accountId");--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "accounts" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "api_tokens_token_hash_unique" ON "api_tokens" USING btree ("tokenHash");--> statement-breakpoint
CREATE INDEX "faa_host_idx" ON "forward_auth_access" USING btree ("proxyHostId");--> statement-breakpoint
CREATE UNIQUE INDEX "faa_user_unique" ON "forward_auth_access" USING btree ("proxyHostId","userId");--> statement-breakpoint
CREATE UNIQUE INDEX "faa_group_unique" ON "forward_auth_access" USING btree ("proxyHostId","groupId");--> statement-breakpoint
CREATE UNIQUE INDEX "fae_code_hash_unique" ON "forward_auth_exchanges" USING btree ("codeHash");--> statement-breakpoint
CREATE UNIQUE INDEX "fari_rid_hash_unique" ON "forward_auth_redirect_intents" USING btree ("ridHash");--> statement-breakpoint
CREATE INDEX "fari_expires_idx" ON "forward_auth_redirect_intents" USING btree ("expiresAt");--> statement-breakpoint
CREATE UNIQUE INDEX "fas_token_hash_unique" ON "forward_auth_sessions" USING btree ("tokenHash");--> statement-breakpoint
CREATE INDEX "fas_user_idx" ON "forward_auth_sessions" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "fas_proxy_host_idx" ON "forward_auth_sessions" USING btree ("proxyHostId");--> statement-breakpoint
CREATE INDEX "fas_expires_idx" ON "forward_auth_sessions" USING btree ("expiresAt");--> statement-breakpoint
CREATE UNIQUE INDEX "group_members_unique" ON "group_members" USING btree ("groupId","userId");--> statement-breakpoint
CREATE INDEX "group_members_user_idx" ON "group_members" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "groups_name_unique" ON "groups" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "instances_base_url_unique" ON "instances" USING btree ("baseUrl");--> statement-breakpoint
CREATE INDEX "issued_client_certificates_ca_idx" ON "issued_client_certificates" USING btree ("caCertificateId");--> statement-breakpoint
CREATE INDEX "issued_client_certificates_revoked_at_idx" ON "issued_client_certificates" USING btree ("revokedAt");--> statement-breakpoint
CREATE INDEX "mtls_access_rules_proxy_host_idx" ON "mtls_access_rules" USING btree ("proxyHostId");--> statement-breakpoint
CREATE UNIQUE INDEX "mtls_access_rules_host_path_unique" ON "mtls_access_rules" USING btree ("proxyHostId","pathPattern");--> statement-breakpoint
CREATE UNIQUE INDEX "mtls_cert_role_unique" ON "mtls_certificate_roles" USING btree ("issuedClientCertificateId","mtlsRoleId");--> statement-breakpoint
CREATE INDEX "mtls_certificate_roles_role_idx" ON "mtls_certificate_roles" USING btree ("mtlsRoleId");--> statement-breakpoint
CREATE UNIQUE INDEX "mtls_roles_name_unique" ON "mtls_roles" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_providers_name_unique" ON "oauth_providers" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_state_unique" ON "oauth_states" USING btree ("state");--> statement-breakpoint
CREATE UNIQUE INDEX "pending_oauth_user_provider_unique" ON "pending_oauth_links" USING btree ("userId","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_unique" ON "sessions" USING btree ("token");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");