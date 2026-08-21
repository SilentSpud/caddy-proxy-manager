-- OIDC group-based role mapping and IdP-managed groups.
-- Per-provider configuration lives on oauth_providers so a deployment can run
-- several IdPs with different group conventions side by side.
ALTER TABLE oauth_providers ADD COLUMN groupsClaim TEXT NOT NULL DEFAULT 'groups';--> statement-breakpoint
ALTER TABLE oauth_providers ADD COLUMN groupPrefix TEXT;--> statement-breakpoint
ALTER TABLE oauth_providers ADD COLUMN roleMappingEnabled INTEGER NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE oauth_providers ADD COLUMN adminGroup TEXT;--> statement-breakpoint
ALTER TABLE oauth_providers ADD COLUMN userGroup TEXT;--> statement-breakpoint
ALTER TABLE oauth_providers ADD COLUMN viewerGroup TEXT;--> statement-breakpoint
ALTER TABLE oauth_providers ADD COLUMN defaultRole TEXT NOT NULL DEFAULT 'user';--> statement-breakpoint
ALTER TABLE oauth_providers ADD COLUMN syncGroups INTEGER NOT NULL DEFAULT 0;--> statement-breakpoint
-- Groups created by an IdP sync are owned by the IdP: membership in them is
-- reconciled on every sign-in. Groups created in the UI keep source='ui' and
-- their membership is never removed by the sync.
ALTER TABLE groups ADD COLUMN source TEXT NOT NULL DEFAULT 'ui';
