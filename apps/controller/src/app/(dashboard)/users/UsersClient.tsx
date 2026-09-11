"use client";

import { useState } from "react";
import { UserCog, Trash2, Pencil, Ban, CheckCircle2, Plus } from "lucide-react";
import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Grid } from "@astryxdesign/core/Grid";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Selector } from "@astryxdesign/core/Selector";
import { TabList, Tab } from "@astryxdesign/core/TabList";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { PageHeader } from "@/components/ui/PageHeader";
import { SearchField } from "@/components/ui/SearchField";
import { StatTiles } from "@/components/ui/StatTiles";
import { GeneratedPasswordField } from "@/src/components/ui/GeneratedPasswordField";
import { AUTOFILL_EMAIL, NATIVE_REQUIRED } from "@/components/ui/native-input-attrs";
import { UserAvatar } from "@/src/components/UserAvatar";
import type { ResolvedAvatar } from "@/src/lib/avatar";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  createUserAction,
  updateUserRoleAction,
  updateUserStatusAction,
  updateUserInfoAction,
  deleteUserAction,
} from "./actions";

type UserEntry = {
  id: number;
  email: string;
  name: string | null;
  role: "admin" | "operator" | "user" | "viewer";
  provider: string | null;
  subject: string | null;
  avatarUrl: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  avatar: ResolvedAvatar;
  /** Most recent session start, or null when no session of theirs is still on file. */
  lastSessionAt: string | null;
};

type Props = {
  users: UserEntry[];
  /** False in OIDC-only mode: accounts come from the IdP, not from this page. */
  localUsersEnabled?: boolean;
};

const ROLE_OPTIONS = [
  { value: "admin", label: "Admin" },
  { value: "operator", label: "Operator" },
  { value: "user", label: "User" },
  { value: "viewer", label: "Viewer" },
];

/** Role tint. Admin reads as elevated privilege, the rest are informational. */
const ROLE_VARIANTS: Record<UserEntry["role"], "red" | "blue" | "neutral"> = {
  admin: "red",
  // Elevated, but only over what their groups were granted - not the whole instance.
  operator: "blue",
  user: "blue",
  viewer: "neutral",
};

/**
 * Rendered on the client on purpose: the server has no way to know the reader's timezone, and a
 * date rendered in the server's would be wrong for everyone else.
 */
function formatSignIn(iso: string) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return at.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function userLabel(user: UserEntry) {
  return user.name ?? user.email.split("@")[0];
}

export default function UsersClient({ users, localUsersEnabled = true }: Props) {
  const t = useTranslations("users");
  const router = useRouter();
  const [editUserId, setEditUserId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  // These actions used to fail silently: nothing caught them and nothing was shown.
  const [error, setError] = useState<string | null>(null);
  const [createRole, setCreateRole] = useState<UserEntry["role"]>("user");
  const [createEmail, setCreateEmail] = useState("");
  const [createName, setCreateName] = useState("");
  const [createPassword, setCreatePassword] = useState("");

  const [roleFilter, setRoleFilter] = useState("all");

  const searched = search
    ? users.filter(
        (u) =>
          u.name?.toLowerCase().includes(search.toLowerCase()) ||
          u.email.toLowerCase().includes(search.toLowerCase()) ||
          u.role.includes(search.toLowerCase()),
      )
    : users;
  const filtered = roleFilter === "all" ? searched : searched.filter((u) => u.role === roleFilter);

  // The tiles and the tab counts report on every account, not on what the search left behind:
  // narrowing the list should not change what the deployment is said to hold.
  const roleCounts = ROLE_OPTIONS.reduce(
    (acc, role) => {
      acc[role.value as UserEntry["role"]] = users.filter((u) => u.role === role.value).length;
      return acc;
    },
    { admin: 0, operator: 0, user: 0, viewer: 0 } as Record<UserEntry["role"], number>,
  );
  const activeCount = users.filter((u) => u.status === "active").length;
  const disabledCount = users.length - activeCount;
  // "local" is the absence of an external provider, so anything else names an IdP.
  const idpCount = users.filter((u) => u.provider && u.provider !== "local").length;
  const withSessionCount = users.filter((u) => u.lastSessionAt).length;

  return (
    <VStack gap={6}>
      <PageHeader title={t("users")} description={t("pageDescription")} />

      {error && <Banner status="error" title={t("errorTitle")} description={error} />}

      <StatTiles
        tiles={[
          {
            id: "total",
            label: t("users"),
            value: users.length,
            note: t("activeDisabledNote", { active: activeCount, disabled: disabledCount }),
          },
          {
            id: "admins",
            label: t("roleAdmins"),
            value: roleCounts.admin,
            note: t("operatorsNote", { count: roleCounts.operator }),
          },
          {
            id: "idp",
            label: t("fromIdp"),
            value: idpCount,
            note: t("reconciledOnSignIn"),
          },
          {
            id: "sessions",
            label: t("withSession"),
            value: withSessionCount,
            note: t("withSessionNote"),
          },
        ]}
      />

      <HStack justify="between" vAlign="center" gap={3} wrap="wrap">
        <TabList value={roleFilter} onChange={setRoleFilter}>
          <Tab value="all" label={t("filterAll")} endContent={<Badge label={users.length} />} />
          {ROLE_OPTIONS.map((role) => (
            <Tab
              key={role.value}
              value={role.value}
              label={role.label}
              endContent={<Badge label={roleCounts[role.value as UserEntry["role"]]} />}
            />
          ))}
        </TabList>
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder={t("searchPlaceholder")}
          label={t("searchLabel")}
        />
      </HStack>

      <HStack justify="between" vAlign="center" gap={3} wrap="wrap">
        <HStack gap={3} vAlign="center">
          <Text type="body" size="sm" color="secondary">
            {filtered.length} user{filtered.length !== 1 ? "s" : ""}
          </Text>
          {localUsersEnabled && (
            <Button
              variant="secondary"
              size="sm"
              icon={<Plus />}
              label={t("createUser")}
              onClick={() => setShowCreate(!showCreate)}
            />
          )}
        </HStack>
      </HStack>

      {localUsersEnabled && showCreate && (
        <Card>
          <form
            action={async (formData) => {
              formData.set("role", createRole);
              const result = await createUserAction(formData);
              if (result.status === "error") {
                setError(result.message ?? null);
                return;
              }
              setError(null);
              setShowCreate(false);
              setCreateRole("user");
              setCreateEmail("");
              setCreateName("");
              setCreatePassword("");
              router.refresh();
            }}
          >
            <VStack gap={3}>
              <Grid columns={{ minWidth: 200, max: 3 }} gap={3}>
                <TextInput
                  {...NATIVE_REQUIRED}
                  {...AUTOFILL_EMAIL}
                  data-testid="create-email"
                  label={t("email")}
                  type="email"
                  htmlName="email"
                  value={createEmail}
                  onChange={setCreateEmail}
                  placeholder={t("emailPlaceholder")}
                  isRequired
                />
                <TextInput
                  data-testid="create-name"
                  label={t("name")}
                  isOptional
                  htmlName="name"
                  value={createName}
                  onChange={setCreateName}
                  placeholder={t("displayName")}
                />
                <Selector
                  data-testid="create-role"
                  label={t("role")}
                  options={ROLE_OPTIONS}
                  value={createRole}
                  onChange={(v) => setCreateRole(v as UserEntry["role"])}
                />
                <GeneratedPasswordField
                  data-testid="create-password"
                  label={t("password")}
                  htmlName="password"
                  value={createPassword}
                  onChange={setCreatePassword}
                  placeholder={t("passwordPlaceholder")}
                  isRequired
                  minLength={8}
                />
              </Grid>
              <HStack gap={2}>
                <Button type="submit" size="sm" label={t("create")} />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  label={t("cancel")}
                  onClick={() => setShowCreate(false)}
                />
              </HStack>
            </VStack>
          </form>
        </Card>
      )}

      {filtered.length === 0 && (
        <Card>
          <EmptyState icon={<UserCog />} title={t("noUsersFound")} />
        </Card>
      )}

      <VStack gap={3}>
        {filtered.map((user) => (
          <Card key={user.id} padding={3}>
            {editUserId === user.id ? (
              <EditUserRow
                user={user}
                onClose={() => setEditUserId(null)}
                onError={setError}
                onSave={() => {
                  setEditUserId(null);
                  router.refresh();
                }}
              />
            ) : (
              <UserRow
                user={user}
                onEdit={() => setEditUserId(user.id)}
                onError={setError}
                onRefresh={() => router.refresh()}
              />
            )}
          </Card>
        ))}
      </VStack>
    </VStack>
  );
}

function UserRow({
  user,
  onEdit,
  onError,
  onRefresh,
}: {
  user: UserEntry;
  onEdit: () => void;
  onError: (message: string | null) => void;
  onRefresh: () => void;
}) {
  const t = useTranslations("users");
  const isDisabled = user.status !== "active";
  const [confirmKind, setConfirmKind] = useState<"disable" | "delete" | null>(null);

  return (
    <HStack gap={3} vAlign="center" justify="between">
      <HStack gap={3} vAlign="center">
        <UserAvatar avatar={user.avatar} alt={user.name ?? user.email} size="md" />
        <VStack gap={0}>
          <HStack gap={2} vAlign="center">
            <Text type="body" size="sm" weight="medium" maxLines={1}>
              {userLabel(user)}
            </Text>
            {isDisabled && <Badge variant="error" label="disabled" />}
          </HStack>
          <Text type="body" size="xsm" color="secondary" maxLines={1}>
            {user.email} · {user.provider}
          </Text>
          <Text type="supporting" color="secondary" maxLines={1}>
            {user.lastSessionAt
              ? t("lastSignedIn", { when: formatSignIn(user.lastSessionAt) })
              : t("noActiveSession")}
          </Text>
        </VStack>
      </HStack>

      <HStack gap={2} vAlign="center">
        <Badge variant={ROLE_VARIANTS[user.role]} label={user.role} />
        <HStack gap={1} vAlign="center">
          {user.status === "active" ? (
            <IconButton
              variant="ghost"
              size="sm"
              label={`Disable user ${userLabel(user)}`}
              tooltip={t("disableUser")}
              icon={<Ban />}
              onClick={() => setConfirmKind("disable")}
            />
          ) : (
            <IconButton
              variant="ghost"
              size="sm"
              label={`Enable user ${userLabel(user)}`}
              tooltip={t("enableUser")}
              icon={<CheckCircle2 />}
              onClick={async () => {
                const result = await updateUserStatusAction(user.id, "active");
                if (result.status === "error") return onError(result.message ?? null);
                onError(null);
                onRefresh();
              }}
            />
          )}
          <IconButton
            variant="ghost"
            size="sm"
            label={`Edit user ${userLabel(user)}`}
            tooltip={t("editUser")}
            icon={<Pencil />}
            onClick={onEdit}
          />
          <IconButton
            variant="ghost"
            size="sm"
            label={`Delete user ${userLabel(user)}`}
            tooltip={t("deleteUser")}
            icon={<Trash2 />}
            onClick={() => setConfirmKind("delete")}
          />
        </HStack>
      </HStack>

      {/* Both actions used window.confirm, which is unstyled and not announced
          as a dialog. The wording is carried over unchanged. */}
      <AlertDialog
        isOpen={confirmKind !== null}
        onOpenChange={(open) => !open && setConfirmKind(null)}
        title={confirmKind === "delete" ? "Delete user" : "Disable user"}
        description={
          confirmKind === "delete"
            ? `Permanently delete user "${user.name ?? user.email}"? This cannot be undone.`
            : `Disable user "${user.name ?? user.email}"?`
        }
        actionLabel={confirmKind === "delete" ? "Delete user" : "Disable user"}
        onAction={async () => {
          const result =
            confirmKind === "delete"
              ? await deleteUserAction(user.id)
              : await updateUserStatusAction(user.id, "disabled");
          setConfirmKind(null);
          if (result.status === "error") return onError(result.message ?? null);
          onError(null);
          onRefresh();
        }}
      />
    </HStack>
  );
}

function EditUserRow({
  user,
  onClose,
  onError,
  onSave,
}: {
  user: UserEntry;
  onClose: () => void;
  onError: (message: string | null) => void;
  onSave: () => void;
}) {
  const t = useTranslations("users");
  const [role, setRole] = useState(user.role);
  const [name, setName] = useState(user.name ?? "");
  const [email, setEmail] = useState(user.email);

  return (
    <VStack gap={3}>
      <HStack gap={2} vAlign="center">
        <Icon icon={Pencil} size="sm" />
        <Text type="body" size="sm" weight="medium">
          Editing {user.name ?? user.email}
        </Text>
      </HStack>
      <form
        action={async (formData) => {
          const info = await updateUserInfoAction(user.id, formData);
          if (info.status === "error") return onError(info.message ?? null);
          if (role !== user.role) {
            const roleResult = await updateUserRoleAction(user.id, role);
            if (roleResult.status === "error") return onError(roleResult.message ?? null);
          }
          onError(null);
          onSave();
        }}
      >
        <VStack gap={3}>
          <Grid columns={{ minWidth: 200, max: 3 }} gap={3}>
            <TextInput
              label={t("name")}
              htmlName="name"
              value={name}
              onChange={setName}
              placeholder={t("displayName")}
            />
            <TextInput
              {...AUTOFILL_EMAIL}
              label={t("email")}
              htmlName="email"
              value={email}
              onChange={setEmail}
              placeholder={t("emailAddress")}
            />
            <Selector
              label={t("role")}
              options={ROLE_OPTIONS}
              value={role}
              onChange={(v) => setRole(v as UserEntry["role"])}
            />
          </Grid>
          <HStack gap={2}>
            <Button type="submit" size="sm" label={t("save")} />
            <Button type="button" variant="ghost" size="sm" label={t("cancel")} onClick={onClose} />
          </HStack>
        </VStack>
      </form>
    </VStack>
  );
}
