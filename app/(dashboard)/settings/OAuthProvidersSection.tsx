"use client";

import { useState, useCallback } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { Grid } from "@astryxdesign/core/Grid";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Selector } from "@astryxdesign/core/Selector";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { AppDialog } from "@/components/ui/AppDialog";
import { AUTOFILL_NEW_PASSWORD } from "@/components/ui/native-input-attrs";
import type { OAuthProvider } from "@/src/lib/models/oauth-providers";
import {
  createOAuthProviderAction,
  updateOAuthProviderAction,
  deleteOAuthProviderAction,
} from "./actions";

interface OAuthProvidersSectionProps {
  initialProviders: OAuthProvider[];
  baseUrl: string;
  /** True when AUTH_DISABLE_LOCAL_USERS=true — SSO is the only way in. */
  localUsersDisabled?: boolean;
}

type AppRole = "admin" | "user" | "viewer";

type FormData = {
  name: string;
  type: string;
  clientId: string;
  clientSecret: string;
  issuer: string;
  authorizationUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  scopes: string;
  autoLink: boolean;
  groupsClaim: string;
  groupPrefix: string;
  roleMappingEnabled: boolean;
  adminGroup: string;
  userGroup: string;
  viewerGroup: string;
  defaultRole: AppRole;
  syncGroups: boolean;
};

const emptyForm: FormData = {
  name: "",
  type: "oidc",
  clientId: "",
  clientSecret: "",
  issuer: "",
  authorizationUrl: "",
  tokenUrl: "",
  userinfoUrl: "",
  scopes: "openid email profile",
  autoLink: false,
  groupsClaim: "groups",
  groupPrefix: "",
  roleMappingEnabled: false,
  adminGroup: "",
  userGroup: "",
  viewerGroup: "",
  defaultRole: "user",
  syncGroups: false,
};

const TYPE_OPTIONS = [
  { value: "oidc", label: "OIDC (OpenID Connect)" },
  { value: "oauth2", label: "OAuth2" },
];

const ROLE_OPTIONS = [
  { value: "admin", label: "Admin" },
  { value: "user", label: "User" },
  { value: "viewer", label: "Viewer" },
];

export default function OAuthProvidersSection({
  initialProviders,
  baseUrl,
  localUsersDisabled = false,
}: OAuthProvidersSectionProps) {
  const [providers, setProviders] = useState(initialProviders);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<OAuthProvider | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<OAuthProvider | null>(null);

  const callbackUrl = useCallback(
    (providerId: string) => `${baseUrl}/api/auth/oauth2/callback/${providerId}`,
    [baseUrl]
  );

  function openAddDialog() {
    setEditingProvider(null);
    setForm(emptyForm);
    setError(null);
    setDialogOpen(true);
  }

  function openEditDialog(provider: OAuthProvider) {
    setEditingProvider(provider);
    setForm({
      name: provider.name,
      type: provider.type,
      clientId: provider.clientId,
      clientSecret: provider.clientSecret,
      issuer: provider.issuer ?? "",
      authorizationUrl: provider.authorizationUrl ?? "",
      tokenUrl: provider.tokenUrl ?? "",
      userinfoUrl: provider.userinfoUrl ?? "",
      scopes: provider.scopes,
      autoLink: provider.autoLink,
      groupsClaim: provider.groupsClaim,
      groupPrefix: provider.groupPrefix ?? "",
      roleMappingEnabled: provider.roleMappingEnabled,
      adminGroup: provider.adminGroup ?? "",
      userGroup: provider.userGroup ?? "",
      viewerGroup: provider.viewerGroup ?? "",
      defaultRole: provider.defaultRole,
      syncGroups: provider.syncGroups,
    });
    setError(null);
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.name.trim() || !form.clientId.trim() || !form.clientSecret.trim()) {
      setError("Name, Client ID, and Client Secret are required.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      if (editingProvider) {
        const updated = await updateOAuthProviderAction(editingProvider.id, {
          name: form.name.trim(),
          type: form.type,
          clientId: form.clientId.trim(),
          clientSecret: form.clientSecret.trim(),
          issuer: form.issuer.trim() || null,
          authorizationUrl: form.authorizationUrl.trim() || null,
          tokenUrl: form.tokenUrl.trim() || null,
          userinfoUrl: form.userinfoUrl.trim() || null,
          scopes: form.scopes.trim() || "openid email profile",
          autoLink: form.autoLink,
          groupsClaim: form.groupsClaim.trim() || "groups",
          groupPrefix: form.groupPrefix.trim() || null,
          roleMappingEnabled: form.roleMappingEnabled,
          adminGroup: form.adminGroup.trim() || null,
          userGroup: form.userGroup.trim() || null,
          viewerGroup: form.viewerGroup.trim() || null,
          defaultRole: form.defaultRole,
          syncGroups: form.syncGroups,
        });
        if (updated) {
          setProviders((prev) =>
            prev.map((p) => (p.id === editingProvider.id ? updated : p))
          );
        }
      } else {
        const created = await createOAuthProviderAction({
          name: form.name.trim(),
          type: form.type,
          clientId: form.clientId.trim(),
          clientSecret: form.clientSecret.trim(),
          issuer: form.issuer.trim() || undefined,
          authorizationUrl: form.authorizationUrl.trim() || undefined,
          tokenUrl: form.tokenUrl.trim() || undefined,
          userinfoUrl: form.userinfoUrl.trim() || undefined,
          scopes: form.scopes.trim() || undefined,
          autoLink: form.autoLink,
          groupsClaim: form.groupsClaim.trim() || undefined,
          groupPrefix: form.groupPrefix.trim() || null,
          roleMappingEnabled: form.roleMappingEnabled,
          adminGroup: form.adminGroup.trim() || null,
          userGroup: form.userGroup.trim() || null,
          viewerGroup: form.viewerGroup.trim() || null,
          defaultRole: form.defaultRole,
          syncGroups: form.syncGroups,
        });
        setProviders((prev) => [...prev, created]);
      }
      setDialogOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleEnabled(provider: OAuthProvider) {
    try {
      const updated = await updateOAuthProviderAction(provider.id, {
        enabled: !provider.enabled,
      });
      if (updated) {
        setProviders((prev) =>
          prev.map((p) => (p.id === provider.id ? updated : p))
        );
      }
    } catch (err) {
      console.error("Failed to toggle provider:", err);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteOAuthProviderAction(id);
      setProviders((prev) => prev.filter((p) => p.id !== id));
      setDeleteConfirm(null);
    } catch (err) {
      console.error("Failed to delete provider:", err);
    }
  }

  function updateField<K extends keyof FormData>(field: K, value: FormData[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  const anyEnabled = providers.some((p) => p.enabled);

  return (
    <VStack gap={3}>
      {localUsersDisabled && (
        <Banner
          status={anyEnabled ? "info" : "error"}
          title="Local user management is disabled (AUTH_DISABLE_LOCAL_USERS=true)"
          description={
            anyEnabled
              ? "All accounts are provisioned by the providers below."
              : "No provider is enabled, so nobody can sign in."
          }
        />
      )}

      {providers.length === 0 && (
        <Banner
          status="info"
          title="No OAuth providers configured"
          description="Add a provider to enable single sign-on."
        />
      )}

      {providers.map((provider) => {
        const isFromEnv = provider.source === "env";
        return (
          <Card key={provider.id} padding={3}>
            <VStack gap={2}>
              <HStack justify="between" gap={3} wrap="wrap" vAlign="center">
                <HStack gap={2} vAlign="center" wrap="wrap">
                  <Text type="body" size="sm" weight="semibold">
                    {provider.name}
                  </Text>
                  <Badge label={provider.type.toUpperCase()} />
                  <Badge
                    variant={isFromEnv ? "info" : "neutral"}
                    label={isFromEnv ? "ENV" : "UI"}
                  />
                  {provider.roleMappingEnabled && <Badge label="Group roles" />}
                  {provider.syncGroups && <Badge label="Group sync" />}
                  {!provider.enabled && <Badge variant="warning" label="Disabled" />}
                </HStack>
                <HStack gap={2} vAlign="center">
                  <Switch
                    label="Enabled"
                    value={provider.enabled}
                    onChange={() => handleToggleEnabled(provider)}
                  />
                  <IconButton
                    variant="secondary"
                    size="sm"
                    label={`Edit ${provider.name}`}
                    icon={<Pencil />}
                    isDisabled={isFromEnv}
                    tooltip={
                      isFromEnv
                        ? "Environment-sourced providers cannot be edited"
                        : "Edit provider"
                    }
                    onClick={() => openEditDialog(provider)}
                  />
                  <IconButton
                    variant="secondary"
                    size="sm"
                    label={`Delete ${provider.name}`}
                    icon={<Trash2 />}
                    isDisabled={isFromEnv}
                    tooltip={
                      isFromEnv
                        ? "Environment-sourced providers cannot be deleted"
                        : "Delete provider"
                    }
                    onClick={() => setDeleteConfirm(provider)}
                  />
                </HStack>
              </HStack>
              {/* CodeBlock owns the copy affordance, replacing the hand-built
                  button and its two-second "Copied!" flag. */}
              <CodeBlock code={callbackUrl(provider.id)} width="100%" />
            </VStack>
          </Card>
        );
      })}

      <HStack justify="end">
        <Button size="sm" icon={<Plus />} label="Add Provider" onClick={openAddDialog} />
      </HStack>

      {/* The inline Confirm/Cancel pair became a real dialog, so a destructive
          action is announced as one. */}
      <AlertDialog
        isOpen={deleteConfirm !== null}
        onOpenChange={(open) => !open && setDeleteConfirm(null)}
        title="Delete OAuth provider"
        description={
          deleteConfirm === null
            ? ""
            : `Delete "${deleteConfirm.name}"? Users who sign in through it will lose access.`
        }
        actionLabel="Delete provider"
        onAction={() => deleteConfirm && handleDelete(deleteConfirm.id)}
      />

      {/* Add / Edit Dialog */}
      <AppDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={editingProvider ? "Edit OAuth Provider" : "Add OAuth Provider"}
        maxWidth="lg"
        submitLabel={editingProvider ? "Update Provider" : "Create Provider"}
        onSubmit={handleSave}
        isSubmitting={saving}
      >
        <VStack gap={3}>
          <Text type="body" size="sm" color="secondary">
            {editingProvider
              ? "Update the OAuth provider configuration."
              : "Configure a new OAuth or OIDC provider for single sign-on."}
          </Text>

          {error && <Banner status="error" title="Could not save provider" description={error} />}

          <TextInput
            label="Name"
            isRequired
            size="sm"
            value={form.name}
            onChange={(v) => updateField("name", v)}
            placeholder="e.g. Google, Keycloak"
          />

          <Selector
            label="Type"
            size="sm"
            options={TYPE_OPTIONS}
            value={form.type}
            onChange={(v) => updateField("type", v)}
          />

          <TextInput
            label="Client ID"
            isRequired
            size="sm"
            value={form.clientId}
            onChange={(v) => updateField("clientId", v)}
          />

          <TextInput
            {...AUTOFILL_NEW_PASSWORD}
            label="Client Secret"
            isRequired
            type="password"
            size="sm"
            value={form.clientSecret}
            onChange={(v) => updateField("clientSecret", v)}
          />

          <TextInput
            label="Issuer URL"
            isOptional
            size="sm"
            value={form.issuer}
            onChange={(v) => updateField("issuer", v)}
            placeholder="https://accounts.google.com"
            description="For OIDC providers, the issuer URL enables automatic discovery of endpoints."
          />

          <TextInput
            label="Authorization URL"
            isOptional
            size="sm"
            value={form.authorizationUrl}
            onChange={(v) => updateField("authorizationUrl", v)}
            placeholder="Override discovered endpoint"
          />

          <TextInput
            label="Token URL"
            isOptional
            size="sm"
            value={form.tokenUrl}
            onChange={(v) => updateField("tokenUrl", v)}
            placeholder="Override discovered endpoint"
          />

          <TextInput
            label="Userinfo URL"
            isOptional
            size="sm"
            value={form.userinfoUrl}
            onChange={(v) => updateField("userinfoUrl", v)}
            placeholder="Override discovered endpoint"
          />

          <TextInput
            label="Scopes"
            size="sm"
            value={form.scopes}
            onChange={(v) => updateField("scopes", v)}
            placeholder="openid email profile"
          />

          <Switch
            label="Auto-link accounts"
            value={form.autoLink}
            onChange={(v) => updateField("autoLink", v)}
            description="Automatically link OAuth accounts to existing users with the same email address."
          />

          <Card variant="muted" padding={3}>
            <VStack gap={3}>
              <VStack gap={0}>
                <Text type="body" size="sm" weight="semibold">
                  Group mapping
                </Text>
                <Text type="body" size="xsm" color="secondary">
                  Derive CPM roles and groups from the identity provider&apos;s group claim.
                </Text>
              </VStack>

              {/* The helper text below used inline <code> spans. Astryx ties a
                  field's description to it via aria-describedby but types it as
                  a plain string, so the monospace styling is traded for keeping
                  that association. */}
              <TextInput
                label="Groups claim"
                size="sm"
                value={form.groupsClaim}
                onChange={(v) => updateField("groupsClaim", v)}
                placeholder="groups"
                description="Claim holding the user's groups. Use dots for nested claims, e.g. resource_access.cpm.roles. Remember to request a matching scope above."
              />

              <TextInput
                label="Group prefix"
                isOptional
                size="sm"
                value={form.groupPrefix}
                onChange={(v) => updateField("groupPrefix", v)}
                placeholder="CPM_"
                description="Shorthand for naming the role groups: with prefix CPM_, members of CPM_Admin become admins, CPM_User users and CPM_Viewer viewers. Name the groups below instead if they do not share a prefix."
              />

              <Switch
                label="Assign roles from groups"
                value={form.roleMappingEnabled}
                onChange={(v) => updateField("roleMappingEnabled", v)}
                description="The provider becomes authoritative: a user who loses the admin group is demoted on their next sign-in. The last remaining admin is never demoted."
              />

              {form.roleMappingEnabled && (
                <>
                  <Grid columns={{ minWidth: 160, max: 3 }} gap={2}>
                    <TextInput
                      label="Admin groups"
                      size="sm"
                      value={form.adminGroup}
                      onChange={(v) => updateField("adminGroup", v)}
                      placeholder={form.groupPrefix ? `${form.groupPrefix}Admin` : "platform-owners"}
                    />
                    <TextInput
                      label="User groups"
                      size="sm"
                      value={form.userGroup}
                      onChange={(v) => updateField("userGroup", v)}
                      placeholder={form.groupPrefix ? `${form.groupPrefix}User` : "staff"}
                    />
                    <TextInput
                      label="Viewer groups"
                      size="sm"
                      value={form.viewerGroup}
                      onChange={(v) => updateField("viewerGroup", v)}
                      placeholder={form.groupPrefix ? `${form.groupPrefix}Viewer` : "auditors"}
                    />
                  </Grid>
                  <Text type="body" size="xsm" color="secondary">
                    Name the groups exactly as your provider reports them. Separate several with
                    commas &mdash; platform-owners, sre-oncall &mdash; and any one of them grants the
                    role. A role left blank falls back to the prefix above, so the two styles can be
                    mixed. The most privileged match wins.
                  </Text>

                  <Selector
                    label="Role when no group matches"
                    size="sm"
                    options={ROLE_OPTIONS}
                    value={form.defaultRole}
                    onChange={(v) => updateField("defaultRole", v as AppRole)}
                  />
                </>
              )}

              <Switch
                label="Mirror groups into CPM groups"
                value={form.syncGroups}
                onChange={(v) => updateField("syncGroups", v)}
                description="Creates CPM groups from the remaining prefixed claims (with the prefix stripped) for forward-auth access control. Groups you created yourself are never modified."
              />
            </VStack>
          </Card>

          {editingProvider && (
            <VStack gap={1}>
              <Text type="label" size="xsm" color="secondary">
                Callback URL
              </Text>
              <CodeBlock code={callbackUrl(editingProvider.id)} width="100%" />
            </VStack>
          )}
        </VStack>
      </AppDialog>
    </VStack>
  );
}
