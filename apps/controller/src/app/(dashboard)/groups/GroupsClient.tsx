"use client";

import { useState } from "react";
import { Users, Plus, Trash2, UserPlus, UserMinus } from "lucide-react";
import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Divider } from "@astryxdesign/core/Divider";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Grid } from "@astryxdesign/core/Grid";
import { Heading } from "@astryxdesign/core/Heading";
import { IconButton } from "@astryxdesign/core/IconButton";
import { List, ListItem } from "@astryxdesign/core/List";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { NATIVE_REQUIRED } from "@/components/ui/native-input-attrs";
import { PageHeader } from "@/components/ui/PageHeader";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  createGroupAction,
  deleteGroupAction,
  addGroupMemberAction,
  removeGroupMemberAction,
} from "./actions";

type GroupMember = {
  userId: number;
  email: string;
  name: string | null;
  createdAt: string;
};

type Group = {
  id: number;
  name: string;
  description: string | null;
  source: string;
  members: GroupMember[];
  createdAt: string;
  updatedAt: string;
};

type UserEntry = {
  id: number;
  email: string;
  name: string | null;
  role: string;
};

type Props = {
  groups: Group[];
  users: UserEntry[];
};

function displayName(entry: { name: string | null; email: string }) {
  return entry.name ?? entry.email.split("@")[0];
}

export default function GroupsClient({ groups, users }: Props) {
  const t = useTranslations("groups");
  const router = useRouter();
  const [showCreate, setShowCreate] = useState(false);
  const [addMemberGroupId, setAddMemberGroupId] = useState<number | null>(null);
  const [deleteGroup, setDeleteGroup] = useState<Group | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  function getAvailableUsers(group: Group): UserEntry[] {
    const memberIds = new Set(group.members.map((m) => m.userId));
    return users.filter((u) => !memberIds.has(u.id));
  }

  return (
    <VStack gap={6}>
      <PageHeader title={t("groups")} description={t("pageDescription")} />

      <HStack justify="end">
        <Button
          variant="secondary"
          size="sm"
          icon={<Plus />}
          label={t("newGroup")}
          onClick={() => setShowCreate(!showCreate)}
        />
      </HStack>

      {showCreate && (
        <Card>
          <form
            action={async (formData) => {
              await createGroupAction(formData);
              setShowCreate(false);
              setName("");
              setDescription("");
              router.refresh();
            }}
          >
            <VStack gap={3}>
              <Grid columns={{ minWidth: 200, max: 2 }} gap={3}>
                <TextInput
                  {...NATIVE_REQUIRED}
                  label={t("name")}
                  htmlName="name"
                  value={name}
                  onChange={setName}
                  placeholder={t("namePlaceholder")}
                  isRequired
                />
                <TextInput
                  label={t("description")}
                  isOptional
                  htmlName="description"
                  value={description}
                  onChange={setDescription}
                  placeholder={t("optionalDescription")}
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

      {groups.length === 0 && !showCreate && (
        <Card>
          <EmptyState
            icon={<Users />}
            title={t("noGroupsYet")}
            description={t("emptyDescription")}
          />
        </Card>
      )}

      <VStack gap={4}>
        {groups.map((group) => {
          const available = getAvailableUsers(group);
          return (
            <Card key={group.id}>
              <VStack gap={3}>
                <HStack justify="between" vAlign="start" gap={3}>
                  <VStack gap={0}>
                    <HStack gap={2} vAlign="center">
                      <Heading level={3}>{group.name}</Heading>
                      {group.source === "oidc" && <Badge variant="info" label={t("idpManaged")} />}
                    </HStack>
                    {group.source === "oidc" && (
                      <Text type="body" size="xsm" color="secondary">
                        {t("idpMembershipHelp")}
                      </Text>
                    )}
                    {group.description && (
                      <Text type="body" size="sm" color="secondary">
                        {group.description}
                      </Text>
                    )}
                  </VStack>
                  <HStack gap={2} vAlign="center">
                    <Badge
                      label={`${group.members.length} member${group.members.length !== 1 ? "s" : ""}`}
                    />
                    <IconButton
                      variant="ghost"
                      size="sm"
                      label={t("addMember")}
                      tooltip={t("addMember")}
                      icon={<UserPlus />}
                      onClick={() =>
                        setAddMemberGroupId(addMemberGroupId === group.id ? null : group.id)
                      }
                    />
                    <IconButton
                      variant="ghost"
                      size="sm"
                      label={`Delete group ${group.name}`}
                      tooltip={t("deleteGroup")}
                      icon={<Trash2 />}
                      onClick={() => setDeleteGroup(group)}
                    />
                  </HStack>
                </HStack>

                {addMemberGroupId === group.id && (
                  <VStack gap={2}>
                    <Text type="body" size="sm" weight="medium">
                      {t("memberPickerLabel")}
                    </Text>
                    {available.length === 0 ? (
                      <Text type="body" size="sm" color="secondary">
                        {t("membersExhaustedMessage")}
                      </Text>
                    ) : (
                      /* Scroll cap kept from the original: neither List nor
                         Stack exposes a max-height, and a fixed height would
                         pad out a short list. */
                      <div style={{ maxHeight: 192, overflowY: "auto" }}>
                        <List hasDividers>
                          {available.map((user) => (
                            <ListItem
                              key={user.id}
                              startContent={<Avatar name={displayName(user)} size="sm" />}
                              label={displayName(user)}
                              description={user.email}
                              endContent={
                                <Text type="body" size="xsm" color="secondary">
                                  {user.role}
                                </Text>
                              }
                              onClick={async () => {
                                await addGroupMemberAction(group.id, user.id);
                                setAddMemberGroupId(null);
                                router.refresh();
                              }}
                            />
                          ))}
                        </List>
                      </div>
                    )}
                    <HStack>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        label={t("cancel")}
                        onClick={() => setAddMemberGroupId(null)}
                      />
                    </HStack>
                  </VStack>
                )}

                {group.members.length > 0 && (
                  <>
                    <Divider />
                    <List>
                      {group.members.map((member) => (
                        <ListItem
                          key={member.userId}
                          startContent={<Avatar name={displayName(member)} size="sm" />}
                          label={displayName(member)}
                          description={member.email}
                          endContent={
                            <IconButton
                              variant="ghost"
                              size="sm"
                              label={`Remove ${displayName(member)} from ${group.name}`}
                              tooltip={t("removeMember")}
                              icon={<UserMinus />}
                              onClick={async () => {
                                await removeGroupMemberAction(group.id, member.userId);
                                router.refresh();
                              }}
                            />
                          }
                        />
                      ))}
                    </List>
                  </>
                )}
              </VStack>
            </Card>
          );
        })}
      </VStack>

      {/* Replaces window.confirm, which was unstyled and not announced as a
          dialog. The IdP caveat is preserved verbatim. */}
      <AlertDialog
        isOpen={deleteGroup !== null}
        onOpenChange={(open) => !open && setDeleteGroup(null)}
        title={t("deleteGroup")}
        description={
          deleteGroup === null
            ? ""
            : deleteGroup.source === "oidc"
              ? `Delete group "${deleteGroup.name}"? It is managed by an identity provider and will be recreated the next time a member signs in.`
              : `Delete group "${deleteGroup.name}"?`
        }
        actionLabel={t("deleteGroup")}
        onAction={async () => {
          if (deleteGroup === null) return;
          await deleteGroupAction(deleteGroup.id);
          setDeleteGroup(null);
          router.refresh();
        }}
      />
    </VStack>
  );
}
