"use client";

import { useState } from "react";
import { UserCog, Trash2, Pencil, Ban, CheckCircle2, Plus } from "lucide-react";
import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Grid } from "@astryxdesign/core/Grid";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { PageHeader } from "@/components/ui/PageHeader";
import { SearchField } from "@/components/ui/SearchField";
import {
  AUTOFILL_EMAIL,
  AUTOFILL_NEW_PASSWORD,
  NATIVE_REQUIRED,
  nativeAttrs,
} from "@/components/ui/native-input-attrs";
import { UserAvatar } from "@/src/components/UserAvatar";
import type { ResolvedAvatar } from "@/src/lib/avatar";
import { useRouter } from "next/navigation";
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
  role: "admin" | "user" | "viewer";
  provider: string | null;
  subject: string | null;
  avatarUrl: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  avatar: ResolvedAvatar;
};

type Props = {
  users: UserEntry[];
  /** False in OIDC-only mode: accounts come from the IdP, not from this page. */
  localUsersEnabled?: boolean;
};

const ROLE_OPTIONS = [
  { value: "admin", label: "Admin" },
  { value: "user", label: "User" },
  { value: "viewer", label: "Viewer" },
];

/** Role tint. Admin reads as elevated privilege, the rest are informational. */
const ROLE_VARIANTS: Record<UserEntry["role"], "red" | "blue" | "neutral"> = {
  admin: "red",
  user: "blue",
  viewer: "neutral",
};

function userLabel(user: UserEntry) {
  return user.name ?? user.email.split("@")[0];
}

export default function UsersClient({ users, localUsersEnabled = true }: Props) {
  const router = useRouter();
  const [editUserId, setEditUserId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [createRole, setCreateRole] = useState<UserEntry["role"]>("user");
  const [createEmail, setCreateEmail] = useState("");
  const [createName, setCreateName] = useState("");
  const [createPassword, setCreatePassword] = useState("");

  const filtered = search
    ? users.filter(
        (u) =>
          u.name?.toLowerCase().includes(search.toLowerCase()) ||
          u.email.toLowerCase().includes(search.toLowerCase()) ||
          u.role.includes(search.toLowerCase())
      )
    : users;

  return (
    <VStack gap={6}>
      <PageHeader title="Users" description="Manage user accounts, roles, and access." />

      <HStack justify="between" vAlign="center" gap={3} wrap="wrap">
        <SearchField value={search} onChange={setSearch} placeholder="Search users..." label="Search users" />
        <HStack gap={3} vAlign="center">
          <Text type="body" size="sm" color="secondary">
            {filtered.length} user{filtered.length !== 1 ? "s" : ""}
          </Text>
          {localUsersEnabled && (
            <Button
              variant="secondary"
              size="sm"
              icon={<Plus />}
              label="Create User"
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
              await createUserAction(formData);
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
                  label="Email"
                  type="email"
                  htmlName="email"
                  value={createEmail}
                  onChange={setCreateEmail}
                  placeholder="user@example.com"
                  isRequired
                />
                <TextInput
                  data-testid="create-name"
                  label="Name"
                  isOptional
                  htmlName="name"
                  value={createName}
                  onChange={setCreateName}
                  placeholder="Display name"
                />
                <Selector
                  data-testid="create-role"
                  label="Role"
                  options={ROLE_OPTIONS}
                  value={createRole}
                  onChange={(v) => setCreateRole(v as UserEntry["role"])}
                />
                <TextInput
                  {...NATIVE_REQUIRED}
                  {...AUTOFILL_NEW_PASSWORD}
                  {...nativeAttrs({ minLength: 8 })}
                  data-testid="create-password"
                  label="Password"
                  type="password"
                  htmlName="password"
                  value={createPassword}
                  onChange={setCreatePassword}
                  placeholder="Min 8 characters"
                  isRequired
                />
              </Grid>
              <HStack gap={2}>
                <Button type="submit" size="sm" label="Create" />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  label="Cancel"
                  onClick={() => setShowCreate(false)}
                />
              </HStack>
            </VStack>
          </form>
        </Card>
      )}

      {filtered.length === 0 && (
        <Card>
          <EmptyState icon={<UserCog />} title="No users found." />
        </Card>
      )}

      <VStack gap={3}>
        {filtered.map((user) => (
          <Card key={user.id} padding={3}>
            {editUserId === user.id ? (
              <EditUserRow
                user={user}
                onClose={() => setEditUserId(null)}
                onSave={() => {
                  setEditUserId(null);
                  router.refresh();
                }}
              />
            ) : (
              <UserRow
                user={user}
                onEdit={() => setEditUserId(user.id)}
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
  onRefresh,
}: {
  user: UserEntry;
  onEdit: () => void;
  onRefresh: () => void;
}) {
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
              tooltip="Disable user"
              icon={<Ban />}
              onClick={() => setConfirmKind("disable")}
            />
          ) : (
            <IconButton
              variant="ghost"
              size="sm"
              label={`Enable user ${userLabel(user)}`}
              tooltip="Enable user"
              icon={<CheckCircle2 />}
              onClick={async () => {
                await updateUserStatusAction(user.id, "active");
                onRefresh();
              }}
            />
          )}
          <IconButton
            variant="ghost"
            size="sm"
            label={`Edit user ${userLabel(user)}`}
            tooltip="Edit user"
            icon={<Pencil />}
            onClick={onEdit}
          />
          <IconButton
            variant="ghost"
            size="sm"
            label={`Delete user ${userLabel(user)}`}
            tooltip="Delete user"
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
          if (confirmKind === "delete") {
            await deleteUserAction(user.id);
          } else {
            await updateUserStatusAction(user.id, "disabled");
          }
          setConfirmKind(null);
          onRefresh();
        }}
      />
    </HStack>
  );
}

function EditUserRow({
  user,
  onClose,
  onSave,
}: {
  user: UserEntry;
  onClose: () => void;
  onSave: () => void;
}) {
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
          await updateUserInfoAction(user.id, formData);
          if (role !== user.role) {
            await updateUserRoleAction(user.id, role);
          }
          onSave();
        }}
      >
        <VStack gap={3}>
          <Grid columns={{ minWidth: 200, max: 3 }} gap={3}>
            <TextInput
              label="Name"
              htmlName="name"
              value={name}
              onChange={setName}
              placeholder="Display name"
            />
            <TextInput
              {...AUTOFILL_EMAIL}
              label="Email"
              htmlName="email"
              value={email}
              onChange={setEmail}
              placeholder="Email address"
            />
            <Selector
              label="Role"
              options={ROLE_OPTIONS}
              value={role}
              onChange={(v) => setRole(v as UserEntry["role"])}
            />
          </Grid>
          <HStack gap={2}>
            <Button type="submit" size="sm" label="Save" />
            <Button type="button" variant="ghost" size="sm" label="Cancel" onClick={onClose} />
          </HStack>
        </VStack>
      </form>
    </VStack>
  );
}
