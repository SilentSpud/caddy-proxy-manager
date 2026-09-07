"use client";

import { type ReactNode, useState } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { DateTimeInput, type ISODateTimeString } from "@astryxdesign/core/DateTimeInput";
import { Divider } from "@astryxdesign/core/Divider";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { FileInput } from "@astryxdesign/core/FileInput";
import { Grid } from "@astryxdesign/core/Grid";
import { Heading } from "@astryxdesign/core/Heading";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { List, ListItem } from "@astryxdesign/core/List";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { AppDialog } from "@/components/ui/AppDialog";
import {
  AUTOFILL_CURRENT_PASSWORD,
  AUTOFILL_NEW_PASSWORD,
} from "@/components/ui/native-input-attrs";
import { UserAvatar } from "@/src/components/UserAvatar";
import type { ResolvedAvatar } from "@/src/lib/avatar";
import { authClient } from "@/src/lib/auth-client";
import { Key, Link, LogIn, Lock, LogOut, Monitor, Plus, Trash2, Unlink, User } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { ApiToken } from "@/lib/models/api-tokens";
import { createApiTokenAction, deleteApiTokenAction } from "../api-tokens/actions";
import { revokeSessionAction, revokeOtherSessionsAction } from "./session-actions";
import { passwordPolicyHint, passwordPolicyMessage } from "@/src/lib/password-policy-message";
import { useTranslations } from "next-intl";

interface ActiveSession {
  id: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  current: boolean;
}

/** Best-effort friendly device label from a User-Agent string. */
function describeDevice(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Mac OS X|Macintosh/.test(ua)
      ? "macOS"
      : /Android/.test(ua)
        ? "Android"
        : /iPhone|iPad|iOS/.test(ua)
          ? "iOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return os ? `${browser} on ${os}` : browser;
}

function relativeTime(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return iso;
  }
}

interface UserData {
  id: number;
  email: string;
  name: string | null;
  provider: string | null;
  subject: string | null;
  passwordHash: string | null;
  role: string;
  avatarUrl: string | null;
}

interface ProfileClientProps {
  user: UserData;
  /** Linked OAuth identities, read from the authoritative accounts table (#261). */
  linkedProviders: Array<{ providerId: string; accountId: string }>;
  enabledProviders: Array<{ id: string; name: string; autoLink: boolean }>;
  apiTokens: ApiToken[];
  sessions: ActiveSession[];
  /** False in OIDC-only mode: local passwords do not exist. */
  localPasswordsEnabled?: boolean;
  /** Icon sources resolved on the server, including the Gravatar fallback. */
  avatar: ResolvedAvatar;
}

/** Card with an icon heading and a rule beneath it, used for every section. */
function ProfileSection({
  icon,
  title,
  action,
  children,
}: {
  icon: LucideIcon;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card padding={6}>
      <VStack gap={4}>
        <HStack justify="between" vAlign="center" gap={2} wrap="wrap">
          <HStack gap={2} vAlign="center">
            <Icon icon={icon} color="accent" />
            <Heading level={2}>{title}</Heading>
          </HStack>
          {action}
        </HStack>
        <Divider />
        {children}
      </VStack>
    </Card>
  );
}

export default function ProfileClient({
  user,
  linkedProviders,
  enabledProviders,
  apiTokens,
  sessions,
  localPasswordsEnabled = true,
  avatar,
}: ProfileClientProps) {
  const t = useTranslations("profile");
  // Unscoped as well, for the password rule — it is shared with every other password field.
  const tRoot = useTranslations();
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [unlinkDialogOpen, setUnlinkDialogOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user.avatarUrl);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [tokenName, setTokenName] = useState("");
  const [tokenExpiresAt, setTokenExpiresAt] = useState<ISODateTimeString | undefined>(undefined);

  const getProviderName = (provider: string) => {
    if (provider === "credentials") return "Username/Password";
    if (provider === "oauth2") return "OAuth2";
    if (provider === "authentik") return "Authentik";
    return provider;
  };

  const hasPassword = !!user.passwordHash;
  // Connection state comes from the accounts rows, not the users.provider projection, so a stale
  // projection cannot make a linked account look unlinked or vice versa (#261).
  const linkedNames = linkedProviders.map(
    (link) =>
      enabledProviders.find((p) => p.id === link.providerId)?.name ??
      getProviderName(link.providerId),
  );
  const hasOAuth = linkedNames.length > 0;

  const handlePasswordChange = async () => {
    setError(null);
    setSuccess(null);

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    const policyError = passwordPolicyMessage(
      tRoot,
      newPassword,
      tRoot("passwordPolicy.subject.password"),
    );
    if (policyError) {
      setError(policyError);
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/user/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Failed to change password");
        setLoading(false);
        return;
      }

      setSuccess("Password changed successfully");
      setPasswordDialogOpen(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setLoading(false);
    } catch {
      setError("An error occurred while changing password");
      setLoading(false);
    }
  };

  const handleUnlinkOAuth = async () => {
    if (!hasPassword) {
      setError("Cannot unlink OAuth: You must set a password first");
      return;
    }

    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      const response = await fetch("/api/user/unlink-oauth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Failed to unlink OAuth");
        setLoading(false);
        return;
      }

      setSuccess("OAuth account unlinked successfully. Reloading...");
      setUnlinkDialogOpen(false);
      setLoading(false);

      // Reload page to reflect changes
      setTimeout(() => window.location.reload(), 1500);
    } catch {
      setError("An error occurred while unlinking OAuth");
      setLoading(false);
    }
  };

  const handleLinkOAuth = async (providerId: string) => {
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      // linkSocial (not signIn.social) binds the identity to the session user
      // and requires the provider email to match, so an unrelated IdP account
      // cannot silently swap the browser onto a different CPM user.
      const { error: linkError } = await authClient.linkSocial({
        provider: providerId,
        callbackURL: "/profile",
      });

      if (linkError) {
        setError(
          linkError.message ||
            'Failed to start OAuth linking. Enable "Auto-link accounts" for this provider first.',
        );
        setLoading(false);
      }
      // On success the client follows the provider redirect.
    } catch {
      setError("An error occurred while linking OAuth");
      setLoading(false);
    }
  };

  const handleAvatarUpload = async (selected: File | File[] | null) => {
    const file = Array.isArray(selected) ? selected[0] : selected;
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      setError("Please upload an image file");
      return;
    }

    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      setError("Image must be smaller than 2MB");
      return;
    }

    setError(null);
    setLoading(true);

    try {
      // Convert to base64
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = reader.result as string;

        const response = await fetch("/api/user/update-avatar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ avatarUrl: base64 }),
        });

        const data = await response.json();

        if (!response.ok) {
          setError(data.error || "Failed to upload avatar");
          setLoading(false);
          return;
        }

        setAvatarUrl(base64);
        setSuccess("Avatar updated successfully. Refreshing...");
        setLoading(false);

        setTimeout(() => window.location.reload(), 1000);
      };

      reader.readAsDataURL(file);
    } catch {
      setError("An error occurred while uploading avatar");
      setLoading(false);
    }
  };

  const handleAvatarDelete = async () => {
    setError(null);
    setLoading(true);

    try {
      const response = await fetch("/api/user/update-avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarUrl: null }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Failed to delete avatar");
        setLoading(false);
        return;
      }

      setAvatarUrl(null);
      setSuccess("Avatar removed successfully. Refreshing...");
      setLoading(false);

      setTimeout(() => window.location.reload(), 1000);
    } catch {
      setError("An error occurred while deleting avatar");
      setLoading(false);
    }
  };

  const handleCreateToken = async (formData: FormData) => {
    setError(null);
    setNewToken(null);
    const result = await createApiTokenAction(formData);
    if ("error" in result) {
      setError(result.error);
    } else {
      setNewToken(result.rawToken);
      setSuccess("API token created successfully");
      setTokenName("");
      setTokenExpiresAt(undefined);
    }
  };

  const formatDate = (iso: string | null): string => {
    if (!iso) return "Never";
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const isExpired = (expiresAt: string | null): boolean => {
    if (!expiresAt) return false;
    return new Date(expiresAt) <= new Date();
  };

  return (
    <VStack gap={6}>
      <Heading level={1}>Profile &amp; Account Settings</Heading>

      {error && (
        <Banner
          status="error"
          title={t("somethingWentWrong")}
          description={error}
          isDismissable
          onDismiss={() => setError(null)}
        />
      )}

      {success && (
        <Banner status="success" title={success} isDismissable onDismiss={() => setSuccess(null)} />
      )}

      <VStack gap={4}>
        <ProfileSection icon={User} title={t("accountInformation")}>
          <VStack gap={4}>
            <VStack gap={2}>
              <Text type="body" size="sm" color="secondary">
                {t("profilePicture")}
              </Text>
              <HStack gap={4} vAlign="center">
                <UserAvatar
                  // avatarUrl is local state so an upload or removal shows
                  // immediately; the Gravatar and initial come from the server.
                  avatar={{ ...avatar, imageUrl: avatarUrl }}
                  alt={user.name || user.email}
                  size="xl"
                />
                <HStack gap={2} vAlign="center">
                  {/* FileInput replaces a <label>-wrapped hidden file input,
                      and brings its own keyboard-reachable trigger. */}
                  <FileInput
                    label={t("uploadProfilePicture")}
                    isLabelHidden
                    accept="image/*"
                    value={null}
                    onChange={handleAvatarUpload}
                    isDisabled={loading}
                    description={t("recommendedSquareImageMax")}
                  />
                  {avatarUrl && (
                    <IconButton
                      variant="ghost"
                      label={t("removeProfilePicture")}
                      tooltip={t("removePicture")}
                      icon={<Trash2 />}
                      isDisabled={loading}
                      onClick={handleAvatarDelete}
                    />
                  )}
                </HStack>
              </HStack>
            </VStack>

            <Divider />

            <MetadataList>
              <MetadataListItem label={t("email")}>{user.email}</MetadataListItem>
              <MetadataListItem label={t("name")}>{user.name || "Not set"}</MetadataListItem>
              <MetadataListItem label={t("role")}>
                <Badge label={user.role} />
              </MetadataListItem>
              <MetadataListItem label={t("authenticationMethod")}>
                <Badge
                  variant={user.provider === "credentials" ? "neutral" : "info"}
                  label={getProviderName(user.provider ?? "")}
                />
              </MetadataListItem>
              {hasPassword && (
                <MetadataListItem label={t("password")}>
                  <Badge variant="success" label={t("passwordIsSet")} />
                </MetadataListItem>
              )}
            </MetadataList>
          </VStack>
        </ProfileSection>

        {localPasswordsEnabled && (
          <ProfileSection icon={Lock} title={t("passwordManagement")}>
            {hasPassword ? (
              <VStack gap={2}>
                <Text type="body" size="sm" color="secondary">
                  {t("changeYourPasswordTo")}
                </Text>
                <HStack>
                  <Button
                    variant="secondary"
                    label={t("changePassword")}
                    onClick={() => setPasswordDialogOpen(true)}
                  />
                </HStack>
              </VStack>
            ) : (
              <VStack gap={3}>
                <Banner
                  status="warning"
                  title={t("youAreUsingOauth")}
                  description={t("settingAPasswordWill")}
                />
                <HStack>
                  <Button label={t("setPassword")} onClick={() => setPasswordDialogOpen(true)} />
                </HStack>
              </VStack>
            )}
          </ProfileSection>
        )}

        <ProfileSection
          icon={Monitor}
          title={t("activeSessions")}
          action={
            sessions.some((s) => !s.current) ? (
              <form action={revokeOtherSessionsAction}>
                <Button
                  type="submit"
                  variant="destructive"
                  size="sm"
                  icon={<LogOut />}
                  label={t("signOutAllOther")}
                />
              </form>
            ) : undefined
          }
        >
          <VStack gap={4}>
            <Text type="body" size="sm" color="secondary">
              {t("devicesCurrentlySignedIn")}
            </Text>

            <List hasDividers>
              {sessions.map((s) => (
                <ListItem
                  key={s.id}
                  startContent={<Icon icon={Monitor} size="sm" color="secondary" />}
                  label={describeDevice(s.userAgent)}
                  description={
                    <HStack gap={3} wrap="wrap" vAlign="center">
                      <Text type="body" size="xsm" color="secondary">
                        Signed in {relativeTime(s.createdAt)}
                      </Text>
                      {s.ipAddress && (
                        <Text type="body" size="xsm" color="secondary">
                          IP {s.ipAddress}
                        </Text>
                      )}
                      <Text type="body" size="xsm" color="secondary">
                        Expires {formatDate(s.expiresAt)}
                      </Text>
                    </HStack>
                  }
                  endContent={
                    s.current ? (
                      <Badge variant="success" label={t("thisDevice")} />
                    ) : (
                      <form action={revokeSessionAction.bind(null, s.id)}>
                        <IconButton
                          type="submit"
                          variant="ghost"
                          size="sm"
                          label={`Revoke session on ${describeDevice(s.userAgent)}`}
                          tooltip={t("revokeSession")}
                          icon={<Trash2 />}
                        />
                      </form>
                    )
                  }
                />
              ))}
            </List>
          </VStack>
        </ProfileSection>

        {enabledProviders.length > 0 && (
          <ProfileSection icon={Link} title={t("oauthConnections")}>
            {hasOAuth ? (
              <VStack gap={2}>
                <Text type="body" size="sm" color="secondary">
                  {linkedNames.length === 1
                    ? `Your account is linked to ${linkedNames[0]}`
                    : `Your account is linked to: ${linkedNames.join(", ")}`}
                </Text>

                {!localPasswordsEnabled ? (
                  <Banner
                    status="info"
                    title={t("thisConnectionCannotBe")}
                    description={t("singleSignOnIs")}
                  />
                ) : hasPassword ? (
                  <HStack>
                    <Button
                      variant="secondary"
                      icon={<Unlink />}
                      label={t("unlinkOauthAccount")}
                      onClick={() => setUnlinkDialogOpen(true)}
                    />
                  </HStack>
                ) : (
                  <Banner
                    status="info"
                    title={t("setAPasswordFirst")}
                    description={t("toUnlinkOauthYou")}
                  />
                )}
              </VStack>
            ) : (
              <VStack gap={3}>
                <Text type="body" size="sm" color="secondary">
                  {t("linkAnOauthProvider")}
                </Text>
                <VStack gap={2}>
                  {enabledProviders.map((provider) => (
                    <Button
                      key={provider.id}
                      variant="secondary"
                      width="100%"
                      icon={<LogIn />}
                      label={`Link ${provider.name}`}
                      onClick={() => handleLinkOAuth(provider.id)}
                    />
                  ))}
                </VStack>
              </VStack>
            )}
          </ProfileSection>
        )}

        <ProfileSection icon={Key} title={t("apiTokens")}>
          <VStack gap={4}>
            <Text type="body" size="sm" color="secondary">
              {t("createTokensForProgrammatic")}
            </Text>

            {newToken && (
              <VStack gap={2}>
                <Text type="body" size="sm" weight="semibold">
                  {t("copyThisTokenNow")}
                </Text>
                {/* CodeBlock owns the copy button, replacing the hand-built one
                    and its two-second "Copied" flag. */}
                <CodeBlock code={newToken} width="100%" />
              </VStack>
            )}

            {apiTokens.length > 0 && (
              <List hasDividers>
                {apiTokens.map((token) => {
                  const expired = isExpired(token.expiresAt);
                  return (
                    <ListItem
                      key={token.id}
                      startContent={<Icon icon={Key} size="sm" color="secondary" />}
                      label={token.name}
                      description={
                        <HStack gap={3} wrap="wrap" vAlign="center">
                          <Text type="body" size="xsm" color="secondary">
                            Created {formatDate(token.createdAt)}
                          </Text>
                          <Text type="body" size="xsm" color="secondary">
                            Used {formatDate(token.lastUsedAt)}
                          </Text>
                          {token.expiresAt && (
                            <Text type="body" size="xsm" color="secondary">
                              {expired ? "Expired" : "Expires"} {formatDate(token.expiresAt)}
                            </Text>
                          )}
                        </HStack>
                      }
                      endContent={
                        <HStack gap={2} vAlign="center">
                          {expired && <Badge variant="error" label={t("expired")} />}
                          <form action={deleteApiTokenAction.bind(null, token.id)}>
                            <IconButton
                              type="submit"
                              variant="ghost"
                              size="sm"
                              label={`Delete token ${token.name}`}
                              tooltip={t("deleteToken")}
                              icon={<Trash2 />}
                            />
                          </form>
                        </HStack>
                      }
                    />
                  );
                })}
              </List>
            )}

            {apiTokens.length === 0 && !newToken && (
              <EmptyState
                icon={<Key />}
                title={t("noApiTokensYet")}
                description={t("createOneBelow")}
                isCompact
              />
            )}

            <form action={handleCreateToken}>
              <VStack gap={3}>
                <Grid columns={{ minWidth: 220, max: 2 }} gap={3}>
                  <TextInput
                    label={t("name")}
                    isRequired
                    size="sm"
                    htmlName="name"
                    value={tokenName}
                    onChange={setTokenName}
                    placeholder={t("eGCiCd")}
                  />
                  <VStack gap={0}>
                    <DateTimeInput
                      label={t("expiresAt")}
                      isOptional
                      size="sm"
                      value={tokenExpiresAt}
                      onChange={setTokenExpiresAt}
                    />
                    {/* DateTimeInput has no htmlName, so the value reaches the
                        server action through this hidden field. */}
                    <input type="hidden" name="expires_at" value={tokenExpiresAt ?? ""} />
                  </VStack>
                </Grid>
                <HStack justify="end">
                  <Button type="submit" size="sm" icon={<Plus />} label={t("createToken")} />
                </HStack>
              </VStack>
            </form>
          </VStack>
        </ProfileSection>
      </VStack>

      <AppDialog
        open={passwordDialogOpen}
        onClose={() => setPasswordDialogOpen(false)}
        title={hasPassword ? "Change Password" : "Set Password"}
        maxWidth="sm"
        submitLabel={hasPassword ? "Change Password" : "Set Password"}
        onSubmit={handlePasswordChange}
        isSubmitting={loading}
      >
        <VStack gap={3}>
          {hasPassword && (
            <TextInput
              {...AUTOFILL_CURRENT_PASSWORD}
              label={t("currentPassword")}
              type="password"
              value={currentPassword}
              onChange={setCurrentPassword}
            />
          )}
          <TextInput
            {...AUTOFILL_NEW_PASSWORD}
            label={t("newPassword")}
            type="password"
            value={newPassword}
            onChange={setNewPassword}
            description={passwordPolicyHint(tRoot)}
          />
          <TextInput
            {...AUTOFILL_NEW_PASSWORD}
            label={t("confirmNewPassword")}
            type="password"
            value={confirmPassword}
            onChange={setConfirmPassword}
          />
        </VStack>
      </AppDialog>

      <AppDialog
        open={unlinkDialogOpen}
        onClose={() => setUnlinkDialogOpen(false)}
        title={t("unlinkOauthAccount")}
        maxWidth="sm"
        submitLabel={t("unlinkOauth")}
        onSubmit={handleUnlinkOAuth}
        isSubmitting={loading}
      >
        <Text type="body" size="sm" color="secondary">
          Are you sure you want to unlink your {linkedNames.join(", ")} account? You will only be
          able to sign in with your username and password after this.
        </Text>
      </AppDialog>
    </VStack>
  );
}
