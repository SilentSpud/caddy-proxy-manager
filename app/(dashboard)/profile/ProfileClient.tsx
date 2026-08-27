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
import { PASSWORD_POLICY_HINT, passwordPolicyError } from "@/src/lib/password-policy";

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
  enabledProviders: Array<{ id: string; name: string }>;
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
  enabledProviders,
  apiTokens,
  sessions,
  localPasswordsEnabled = true,
  avatar,
}: ProfileClientProps) {
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

  const hasPassword = !!user.passwordHash;
  const hasOAuth = !!user.provider && user.provider !== "credentials";

  const handlePasswordChange = async () => {
    setError(null);
    setSuccess(null);

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    const policyError = passwordPolicyError(newPassword);
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
      // Set a cookie to indicate this is a linking attempt
      const response = await fetch("/api/user/link-oauth-start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerId }),
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || "Failed to start OAuth linking");
        setLoading(false);
        return;
      }

      // Now initiate OAuth flow
      await authClient.signIn.social({ provider: providerId, callbackURL: "/profile" });
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

  const getProviderName = (provider: string) => {
    if (provider === "credentials") return "Username/Password";
    if (provider === "oauth2") return "OAuth2";
    if (provider === "authentik") return "Authentik";
    return provider;
  };

  return (
    <VStack gap={6}>
      <Heading level={1}>Profile &amp; Account Settings</Heading>

      {error && (
        <Banner
          status="error"
          title="Something went wrong"
          description={error}
          isDismissable
          onDismiss={() => setError(null)}
        />
      )}

      {success && (
        <Banner status="success" title={success} isDismissable onDismiss={() => setSuccess(null)} />
      )}

      <VStack gap={4}>
        <ProfileSection icon={User} title="Account Information">
          <VStack gap={4}>
            <VStack gap={2}>
              <Text type="body" size="sm" color="secondary">
                Profile Picture
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
                    label="Upload profile picture"
                    isLabelHidden
                    accept="image/*"
                    value={null}
                    onChange={handleAvatarUpload}
                    isDisabled={loading}
                    description="Recommended: square image, max 2MB"
                  />
                  {avatarUrl && (
                    <IconButton
                      variant="ghost"
                      label="Remove profile picture"
                      tooltip="Remove picture"
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
              <MetadataListItem label="Email">{user.email}</MetadataListItem>
              <MetadataListItem label="Name">{user.name || "Not set"}</MetadataListItem>
              <MetadataListItem label="Role">
                <Badge label={user.role} />
              </MetadataListItem>
              <MetadataListItem label="Authentication Method">
                <Badge
                  variant={user.provider === "credentials" ? "neutral" : "info"}
                  label={getProviderName(user.provider ?? "")}
                />
              </MetadataListItem>
              {hasPassword && (
                <MetadataListItem label="Password">
                  <Badge variant="success" label="Password is set" />
                </MetadataListItem>
              )}
            </MetadataList>
          </VStack>
        </ProfileSection>

        {localPasswordsEnabled && (
          <ProfileSection icon={Lock} title="Password Management">
            {hasPassword ? (
              <VStack gap={2}>
                <Text type="body" size="sm" color="secondary">
                  Change your password to maintain account security
                </Text>
                <HStack>
                  <Button
                    variant="secondary"
                    label="Change Password"
                    onClick={() => setPasswordDialogOpen(true)}
                  />
                </HStack>
              </VStack>
            ) : (
              <VStack gap={3}>
                <Banner
                  status="warning"
                  title="You are using OAuth-only authentication"
                  description="Setting a password will allow you to sign in with either OAuth or credentials."
                />
                <HStack>
                  <Button label="Set Password" onClick={() => setPasswordDialogOpen(true)} />
                </HStack>
              </VStack>
            )}
          </ProfileSection>
        )}

        <ProfileSection
          icon={Monitor}
          title="Active Sessions"
          action={
            sessions.some((s) => !s.current) ? (
              <form action={revokeOtherSessionsAction}>
                <Button
                  type="submit"
                  variant="destructive"
                  size="sm"
                  icon={<LogOut />}
                  label="Sign out all other sessions"
                />
              </form>
            ) : undefined
          }
        >
          <VStack gap={4}>
            <Text type="body" size="sm" color="secondary">
              Devices currently signed in to your account. Revoke any you don&apos;t recognise.
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
                      <Badge variant="success" label="This device" />
                    ) : (
                      <form action={revokeSessionAction.bind(null, s.id)}>
                        <IconButton
                          type="submit"
                          variant="ghost"
                          size="sm"
                          label={`Revoke session on ${describeDevice(s.userAgent)}`}
                          tooltip="Revoke session"
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
          <ProfileSection icon={Link} title="OAuth Connections">
            {hasOAuth ? (
              <VStack gap={2}>
                <Text type="body" size="sm" color="secondary">
                  Your account is linked to {getProviderName(user.provider ?? "")}
                </Text>

                {!localPasswordsEnabled ? (
                  <Banner
                    status="info"
                    title="This connection cannot be unlinked"
                    description="Single sign-on is the only authentication method on this instance."
                  />
                ) : hasPassword ? (
                  <HStack>
                    <Button
                      variant="secondary"
                      icon={<Unlink />}
                      label="Unlink OAuth Account"
                      onClick={() => setUnlinkDialogOpen(true)}
                    />
                  </HStack>
                ) : (
                  <Banner
                    status="info"
                    title="Set a password first"
                    description="To unlink OAuth, you must first set a password as a fallback authentication method."
                  />
                )}
              </VStack>
            ) : (
              <VStack gap={3}>
                <Text type="body" size="sm" color="secondary">
                  Link an OAuth provider to enable single sign-on
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

        <ProfileSection icon={Key} title="API Tokens">
          <VStack gap={4}>
            <Text type="body" size="sm" color="secondary">
              Create tokens for programmatic access to the API using the header Authorization:
              Bearer &lt;token&gt;
            </Text>

            {newToken && (
              <VStack gap={2}>
                <Text type="body" size="sm" weight="semibold">
                  Copy this token now &mdash; it will not be shown again.
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
                          {expired && <Badge variant="error" label="Expired" />}
                          <form action={deleteApiTokenAction.bind(null, token.id)}>
                            <IconButton
                              type="submit"
                              variant="ghost"
                              size="sm"
                              label={`Delete token ${token.name}`}
                              tooltip="Delete token"
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
                title="No API tokens yet"
                description="Create one below."
                isCompact
              />
            )}

            <form action={handleCreateToken}>
              <VStack gap={3}>
                <Grid columns={{ minWidth: 220, max: 2 }} gap={3}>
                  <TextInput
                    label="Name"
                    isRequired
                    size="sm"
                    htmlName="name"
                    value={tokenName}
                    onChange={setTokenName}
                    placeholder="e.g. CI/CD Pipeline"
                  />
                  <VStack gap={0}>
                    <DateTimeInput
                      label="Expires at"
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
                  <Button type="submit" size="sm" icon={<Plus />} label="Create Token" />
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
              label="Current Password"
              type="password"
              value={currentPassword}
              onChange={setCurrentPassword}
            />
          )}
          <TextInput
            {...AUTOFILL_NEW_PASSWORD}
            label="New Password"
            type="password"
            value={newPassword}
            onChange={setNewPassword}
            description={PASSWORD_POLICY_HINT}
          />
          <TextInput
            {...AUTOFILL_NEW_PASSWORD}
            label="Confirm New Password"
            type="password"
            value={confirmPassword}
            onChange={setConfirmPassword}
          />
        </VStack>
      </AppDialog>

      <AppDialog
        open={unlinkDialogOpen}
        onClose={() => setUnlinkDialogOpen(false)}
        title="Unlink OAuth Account"
        maxWidth="sm"
        submitLabel="Unlink OAuth"
        onSubmit={handleUnlinkOAuth}
        isSubmitting={loading}
      >
        <Text type="body" size="sm" color="secondary">
          Are you sure you want to unlink your {getProviderName(user.provider ?? "")} account? You
          will only be able to sign in with your username and password after this.
        </Text>
      </AppDialog>
    </VStack>
  );
}
