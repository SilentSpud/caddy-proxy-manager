"use client";

import { useState, useCallback, useMemo } from "react";
import { Pencil, Plus, Star, Trash2 } from "lucide-react";
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
import { useTranslations } from "next-intl";
import {
  oauthCallbackUrl,
  oidcBackchannelLogoutUrl,
  withOAuthClientSecretRotation,
  type OAuthProviderView,
} from "@/src/lib/oauth-provider-view";
import {
  createOAuthProviderAction,
  setPrimaryOAuthProviderAction,
  updateOAuthProviderAction,
  deleteOAuthProviderAction,
} from "./actions";

interface OAuthProvidersSectionProps {
  initialProviders: OAuthProviderView[];
  /** The provider offered first on the sign-in screen, or null for alphabetical order. */
  initialPrimaryProviderId?: string | null;
  baseUrl: string;
  /** True when AUTH_DISABLE_LOCAL_USERS=true - SSO is the only way in. */
  localUsersDisabled?: boolean;
}

type AppRole = "admin" | "operator" | "user" | "viewer";

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
  operatorGroup: string;
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
  operatorGroup: "",
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
  { value: "operator", label: "Operator" },
  { value: "user", label: "User" },
  { value: "viewer", label: "Viewer" },
];

export default function OAuthProvidersSection({
  initialProviders,
  initialPrimaryProviderId = null,
  baseUrl,
  localUsersDisabled = false,
}: OAuthProvidersSectionProps) {
  const t = useTranslations("settings");
  const [providers, setProviders] = useState(initialProviders);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<OAuthProviderView | null>(null);
  const [rotateClientSecret, setRotateClientSecret] = useState(false);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<OAuthProviderView | null>(null);
  // Which provider the sign-in screen offers first. Held here so the badge moves with the
  // click rather than waiting for a reload.
  const [primaryId, setPrimaryId] = useState<string | null>(initialPrimaryProviderId);

  const callbackUrl = useCallback(
    (providerId: string) => oauthCallbackUrl(baseUrl, providerId),
    [baseUrl],
  );

  // One URL for every provider - the logout token names its own issuer, which is what picks the
  // provider it gets verified against.
  const backchannelLogoutUrl = useMemo(() => oidcBackchannelLogoutUrl(baseUrl), [baseUrl]);

  function closeDialog() {
    // Clear any newly-entered replacement secret from client memory as soon
    // as the dialog closes.
    setDialogOpen(false);
    setEditingProvider(null);
    setRotateClientSecret(false);
    setForm(emptyForm);
    setError(null);
  }

  function openAddDialog() {
    setEditingProvider(null);
    setRotateClientSecret(true);
    setForm(emptyForm);
    setError(null);
    setDialogOpen(true);
  }

  function openEditDialog(provider: OAuthProviderView) {
    setEditingProvider(provider);
    setRotateClientSecret(false);
    setForm({
      name: provider.name,
      type: provider.type,
      clientId: provider.clientId,
      clientSecret: "",
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
      operatorGroup: provider.operatorGroup ?? "",
      userGroup: provider.userGroup ?? "",
      viewerGroup: provider.viewerGroup ?? "",
      defaultRole: provider.defaultRole,
      syncGroups: provider.syncGroups,
    });
    setError(null);
    setDialogOpen(true);
  }

  async function handleSave() {
    const secretRequired =
      !editingProvider || rotateClientSecret || !editingProvider.hasClientSecret;
    if (
      !form.name.trim() ||
      !form.clientId.trim() ||
      (secretRequired && !form.clientSecret.trim())
    ) {
      setError("Name, Client ID, and Client Secret are required.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      if (editingProvider) {
        const update = withOAuthClientSecretRotation(
          {
            name: form.name.trim(),
            type: form.type,
            clientId: form.clientId.trim(),
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
            operatorGroup: form.operatorGroup.trim() || null,
            userGroup: form.userGroup.trim() || null,
            viewerGroup: form.viewerGroup.trim() || null,
            defaultRole: form.defaultRole,
            syncGroups: form.syncGroups,
          },
          secretRequired ? form.clientSecret : undefined,
        );
        const updated = await updateOAuthProviderAction(editingProvider.id, update);
        if (updated) {
          setProviders((prev) => prev.map((p) => (p.id === editingProvider.id ? updated : p)));
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
          operatorGroup: form.operatorGroup.trim() || null,
          userGroup: form.userGroup.trim() || null,
          viewerGroup: form.viewerGroup.trim() || null,
          defaultRole: form.defaultRole,
          syncGroups: form.syncGroups,
        });
        setProviders((prev) => [...prev, created]);
      }
      closeDialog();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("unexpectedError"));
    } finally {
      setSaving(false);
    }
  }

  async function handleSetPrimary(provider: OAuthProviderView) {
    // Clicking the current primary clears it, which is how the operator gets back to the
    // alphabetical list without a separate control for "none".
    const next = primaryId === provider.id ? null : provider.id;
    setPrimaryId(next);
    try {
      await setPrimaryOAuthProviderAction(next);
    } catch (err) {
      console.error("Failed to set the primary provider:", err);
      setPrimaryId(primaryId);
    }
  }

  async function handleToggleEnabled(provider: OAuthProviderView) {
    try {
      const updated = await updateOAuthProviderAction(provider.id, {
        enabled: !provider.enabled,
      });
      if (updated) {
        setProviders((prev) => prev.map((p) => (p.id === provider.id ? updated : p)));
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
          title={t("localUsersDisabledTitle")}
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
          title={t("noOauthProvidersConfigured")}
          description={t("providersEmptyDescription")}
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
                  {provider.roleMappingEnabled && <Badge label={t("groupRoles")} />}
                  {provider.syncGroups && <Badge label={t("groupSync")} />}
                  {!provider.enabled && <Badge variant="warning" label={t("disabled")} />}
                  {primaryId === provider.id && provider.enabled && (
                    <Badge variant="pink" label={t("primaryProvider")} />
                  )}
                </HStack>
                <HStack gap={2} vAlign="center">
                  <Switch
                    label={t("enabled")}
                    value={provider.enabled}
                    onChange={() => handleToggleEnabled(provider)}
                  />
                  <IconButton
                    variant="secondary"
                    size="sm"
                    label={primaryId === provider.id ? t("clearPrimary") : t("makePrimary")}
                    icon={<Star />}
                    isDisabled={!provider.enabled}
                    tooltip={primaryId === provider.id ? t("clearPrimary") : t("makePrimary")}
                    onClick={() => handleSetPrimary(provider)}
                  />
                  <IconButton
                    variant="secondary"
                    size="sm"
                    label={`Edit ${provider.name}`}
                    icon={<Pencil />}
                    isDisabled={isFromEnv}
                    tooltip={
                      isFromEnv ? "Environment-sourced providers cannot be edited" : "Edit provider"
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
        <Button size="sm" icon={<Plus />} label={t("addProvider")} onClick={openAddDialog} />
      </HStack>

      {/* The inline Confirm/Cancel pair became a real dialog, so a destructive
          action is announced as one. */}
      <AlertDialog
        isOpen={deleteConfirm !== null}
        onOpenChange={(open) => !open && setDeleteConfirm(null)}
        title={t("deleteOauthProvider")}
        description={
          deleteConfirm === null
            ? ""
            : `Delete "${deleteConfirm.name}"? Users who sign in through it will lose access.`
        }
        actionLabel={t("deleteProvider")}
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

          {error && <Banner status="error" title={t("couldNotSaveProvider")} description={error} />}

          <TextInput
            label={t("name")}
            isRequired
            size="sm"
            value={form.name}
            onChange={(v) => updateField("name", v)}
            placeholder={t("providerNamePlaceholder")}
          />

          <Selector
            label={t("type")}
            size="sm"
            options={TYPE_OPTIONS}
            value={form.type}
            onChange={(v) => updateField("type", v)}
          />

          <TextInput
            label={t("clientId")}
            isRequired
            size="sm"
            value={form.clientId}
            onChange={(v) => updateField("clientId", v)}
          />

          {editingProvider?.hasClientSecret && !rotateClientSecret ? (
            <HStack justify="between" vAlign="center" gap={3}>
              <VStack gap={1}>
                <Text type="label" size="xsm">
                  {t("secretLabel")}
                </Text>
                <Text type="body" size="xsm" color="secondary">
                  {t("storedSecretHelp")}
                </Text>
              </VStack>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                label={t("rotateSecret")}
                onClick={() => setRotateClientSecret(true)}
              />
            </HStack>
          ) : (
            <VStack gap={2}>
              <TextInput
                {...AUTOFILL_NEW_PASSWORD}
                label={editingProvider ? "New Client Secret" : "Client Secret"}
                isRequired
                type="password"
                size="sm"
                value={form.clientSecret}
                onChange={(v) => updateField("clientSecret", v)}
              />
              {editingProvider?.hasClientSecret && rotateClientSecret && (
                // Rotating is otherwise a one-way door: isClientSecretRequired turns on with it,
                // so a misclick forces either inventing a new secret or losing the whole dialog.
                <HStack justify="end">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    label={t("keepExisting")}
                    onClick={() => {
                      setRotateClientSecret(false);
                      updateField("clientSecret", "");
                    }}
                  />
                </HStack>
              )}
            </VStack>
          )}

          <TextInput
            label={t("issuerUrl")}
            isOptional
            size="sm"
            value={form.issuer}
            onChange={(v) => updateField("issuer", v)}
            placeholder="https://accounts.google.com"
            description={t("issuerUrlHelp")}
          />

          <TextInput
            label={t("authorizationUrl")}
            isOptional
            size="sm"
            value={form.authorizationUrl}
            onChange={(v) => updateField("authorizationUrl", v)}
            placeholder={t("overrideDiscoveredEndpoint")}
          />

          <TextInput
            label={t("tokenUrl")}
            isOptional
            size="sm"
            value={form.tokenUrl}
            onChange={(v) => updateField("tokenUrl", v)}
            placeholder={t("overrideDiscoveredEndpoint")}
          />

          <TextInput
            label={t("userinfoUrl")}
            isOptional
            size="sm"
            value={form.userinfoUrl}
            onChange={(v) => updateField("userinfoUrl", v)}
            placeholder={t("overrideDiscoveredEndpoint")}
          />

          <TextInput
            label={t("scopes")}
            size="sm"
            value={form.scopes}
            onChange={(v) => updateField("scopes", v)}
            placeholder={t("scopesPlaceholder")}
          />

          <Switch
            label={t("autoLinkAccounts")}
            value={form.autoLink}
            onChange={(v) => updateField("autoLink", v)}
            description={t("oauthAutoLinkHelp")}
          />

          <Card variant="muted" padding={3}>
            <VStack gap={3}>
              <VStack gap={0}>
                <Text type="body" size="sm" weight="semibold">
                  {t("groupMapping")}
                </Text>
                <Text type="body" size="xsm" color="secondary">
                  {t("groupMappingHelp")}
                </Text>
              </VStack>

              {/* The helper text below used inline <code> spans. Astryx ties a
                  field's description to it via aria-describedby but types it as
                  a plain string, so the monospace styling is traded for keeping
                  that association. */}
              <TextInput
                label={t("groupsClaim")}
                size="sm"
                value={form.groupsClaim}
                onChange={(v) => updateField("groupsClaim", v)}
                placeholder="groups"
                description={t("groupsClaimHelp")}
              />

              <TextInput
                label={t("groupPrefix")}
                isOptional
                size="sm"
                value={form.groupPrefix}
                onChange={(v) => updateField("groupPrefix", v)}
                placeholder="CPM_"
                description={t("groupPrefixHelp")}
              />

              <Switch
                label={t("assignRolesFromGroups")}
                value={form.roleMappingEnabled}
                onChange={(v) => updateField("roleMappingEnabled", v)}
                description={t("roleMappingAuthorityHelp")}
              />

              {form.roleMappingEnabled && (
                <>
                  <Grid columns={{ minWidth: 160, max: 3 }} gap={2}>
                    <TextInput
                      label={t("adminGroups")}
                      size="sm"
                      value={form.adminGroup}
                      onChange={(v) => updateField("adminGroup", v)}
                      placeholder={
                        form.groupPrefix ? `${form.groupPrefix}Admin` : "platform-owners"
                      }
                    />
                    <TextInput
                      label={t("operatorGroups")}
                      size="sm"
                      value={form.operatorGroup}
                      onChange={(v) => updateField("operatorGroup", v)}
                      placeholder={form.groupPrefix ? `${form.groupPrefix}Operator` : "proxy-ops"}
                    />
                    <TextInput
                      label={t("userGroups")}
                      size="sm"
                      value={form.userGroup}
                      onChange={(v) => updateField("userGroup", v)}
                      placeholder={form.groupPrefix ? `${form.groupPrefix}User` : "staff"}
                    />
                    <TextInput
                      label={t("viewerGroups")}
                      size="sm"
                      value={form.viewerGroup}
                      onChange={(v) => updateField("viewerGroup", v)}
                      placeholder={form.groupPrefix ? `${form.groupPrefix}Viewer` : "auditors"}
                    />
                  </Grid>
                  <Text type="body" size="xsm" color="secondary">
                    {t("roleGroupNamesHelp")}
                  </Text>

                  <Selector
                    label={t("defaultRoleLabel")}
                    size="sm"
                    options={ROLE_OPTIONS}
                    value={form.defaultRole}
                    onChange={(v) => updateField("defaultRole", v as AppRole)}
                  />
                </>
              )}

              <Switch
                label={t("mirrorGroupsIntoCpm")}
                value={form.syncGroups}
                onChange={(v) => updateField("syncGroups", v)}
                description={t("groupSyncHelp")}
              />
            </VStack>
          </Card>

          {editingProvider && (
            <VStack gap={1}>
              <Text type="label" size="xsm" color="secondary">
                {t("callbackUrl")}
              </Text>
              <CodeBlock code={callbackUrl(editingProvider.id)} width="100%" />
            </VStack>
          )}

          {/* Optional, and only meaningful once the provider is saved - but it belongs beside the
              callback URL, which is the other value being copied into the IdP's own form. */}
          <VStack gap={1}>
            <Text type="label" size="xsm" color="secondary">
              {t("backChannelLogoutUrl")}
            </Text>
            <CodeBlock code={backchannelLogoutUrl} width="100%" />
            <Text type="body" size="xsm" color="secondary">
              {t("backChannelLogoutHelp")}
            </Text>
          </VStack>
        </VStack>
      </AppDialog>
    </VStack>
  );
}
