"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  KeyRound,
  Plus,
  Users,
  Globe,
  Settings2,
  RefreshCw,
  Trash2,
  Sparkles,
  AlertTriangle,
  Clock,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { AccessList, AccessListUsage } from "@/lib/models/access-lists";
import { withRowId, type WithRowId } from "@/lib/row-id";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Heading } from "@astryxdesign/core/Heading";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Kbd } from "@astryxdesign/core/Kbd";
import { Layout, LayoutContent, LayoutPanel } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import {
  Table,
  pixel,
  proportional,
  useTableSelection,
  type TableColumn,
} from "@astryxdesign/core/Table";
import { TabList, Tab } from "@astryxdesign/core/TabList";
import { Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { AppDialog } from "@/components/ui/AppDialog";
import { SearchField } from "@/components/ui/SearchField";
import { AUTOFILL_OFF } from "@/components/ui/native-input-attrs";
import {
  createAccessListAction,
  updateAccessListAction,
  deleteAccessListAction,
  addAccessEntryAction,
  deleteAccessEntryAction,
  bulkDeleteEntriesAction,
  regeneratePasswordAction,
} from "./actions";

type Props = {
  lists: AccessList[];
  usage: Record<number, AccessListUsage[]>;
};

// --- Helpers ---

function fmtRelative(iso: string | null): string {
  if (!iso) return "never";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 86400 * 365) return `${Math.floor(diff / 86400 / 30)}mo ago`;
  return `${Math.floor(diff / 86400 / 365)}y ago`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

type StrengthVariant = "neutral" | "error" | "warning" | "accent" | "success";

function pwStrength(pw: string): { score: number; label: string; variant: StrengthVariant } {
  if (!pw) return { score: 0, label: "Empty", variant: "neutral" };
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 14) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  const map: { label: string; variant: StrengthVariant }[] = [
    { label: "Empty", variant: "neutral" },
    { label: "Weak", variant: "error" },
    { label: "Fair", variant: "warning" },
    { label: "Good", variant: "accent" },
    { label: "Strong", variant: "success" },
    { label: "Excellent", variant: "success" },
  ];
  return { score: s, ...map[s] };
}

function genPassword(len = 18): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#%&*";
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  return Array.from(buf, (v) => chars[v % chars.length]).join("");
}

type SortKey = "recent" | "name" | "members" | "usage";

type MemberRow = {
  id: number;
  username: string;
  createdAt: string | null;
  [key: string]: unknown;
};

// --- Members Tab ---

function MembersTab({
  list,
  onListUpdated,
}: {
  list: AccessList;
  onListUpdated: (list: AccessList) => void;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ username: "", password: "" });
  const [submitting, setSubmitting] = useState(false);

  const removeSelected = async () => {
    const ids = Array.from(selected);
    const updated = await bulkDeleteEntriesAction(list.id, ids);
    if (updated) onListUpdated(updated);
    toast.success(`Removed ${ids.length} ${ids.length === 1 ? "member" : "members"}`);
    setSelected(new Set());
  };

  const removeOne = async (id: number) => {
    const entry = list.entries.find((e) => e.id === id);
    const updated = await deleteAccessEntryAction(list.id, id);
    if (updated) onListUpdated(updated);
    toast.success(`Removed ${entry?.username ?? "member"}`);
  };

  const regen = async (id: number) => {
    const pw = genPassword();
    const updated = await regeneratePasswordAction(list.id, id, pw);
    if (updated) onListUpdated(updated);
    try {
      await navigator.clipboard.writeText(pw);
      toast.success("New password generated and copied");
    } catch {
      toast.success("New password generated");
    }
  };

  const submitNew = async () => {
    if (!draft.username.trim() || !draft.password) return;
    if (list.entries.some((e) => e.username === draft.username.trim())) {
      toast.error("Username already exists");
      return;
    }
    setSubmitting(true);
    try {
      const updated = await addAccessEntryAction(list.id, {
        username: draft.username.trim(),
        password: draft.password,
      });
      onListUpdated(updated);
      setDraft({ username: "", password: "" });
      setAdding(false);
      toast.success(`Added ${draft.username.trim()}`);
    } finally {
      setSubmitting(false);
    }
  };

  const strength = pwStrength(draft.password);

  const rows: MemberRow[] = list.entries.map((e) => ({
    id: e.id,
    username: e.username,
    createdAt: e.createdAt,
  }));

  // Replaces the hand-built <input type="checkbox"> column: the plugin owns the
  // select-all/indeterminate state and labels each checkbox for screen readers.
  const selection = useTableSelection<MemberRow>({
    getIsItemSelected: (row) => selected.has(row.id),
    onSelectItem: ({ item, isSelected }) =>
      setSelected((prev) => {
        const next = new Set(prev);
        if (isSelected) next.add(item.id);
        else next.delete(item.id);
        return next;
      }),
    onSelectAll: ({ isAllSelected }) =>
      setSelected(isAllSelected ? new Set(rows.map((r) => r.id)) : new Set()),
    getIsAllSelected: () => rows.length > 0 && selected.size === rows.length,
    getIsIndeterminate: () => selected.size > 0 && selected.size < rows.length,
    getRowLabel: (row) => row.username,
  });

  const columns: TableColumn<MemberRow>[] = [
    {
      key: "username",
      header: "Username",
      width: proportional(1),
      renderCell: (row) => (
        <Text type="code" size="sm" weight="medium">
          {row.username}
        </Text>
      ),
    },
    {
      key: "password",
      header: "Password",
      width: pixel(180),
      renderCell: (row) => (
        <HStack gap={1} vAlign="center">
          <Text type="code" size="xsm" color="secondary">
            ••••••••••••
          </Text>
          <IconButton
            variant="ghost"
            size="sm"
            label={`Regenerate password for ${row.username}`}
            tooltip="Regenerate password (copies the new one to the clipboard)"
            icon={<RefreshCw />}
            onClick={() => regen(row.id)}
          />
        </HStack>
      ),
    },
    {
      key: "createdAt",
      header: "Added",
      width: pixel(140),
      renderCell: (row) => (
        <Text type="body" size="xsm" color="secondary">
          {fmtDate(row.createdAt)}
        </Text>
      ),
    },
    {
      key: "__remove",
      header: "",
      width: pixel(48),
      align: "end",
      resizable: false,
      renderCell: (row) => (
        <IconButton
          variant="ghost"
          size="sm"
          label={`Remove ${row.username}`}
          tooltip="Remove"
          icon={<Trash2 />}
          onClick={() => removeOne(row.id)}
        />
      ),
    },
  ];

  return (
    <VStack gap={3}>
      <HStack justify="between" vAlign="center" gap={3} wrap="wrap">
        <HStack gap={2} vAlign="center">
          {selected.size > 0 ? (
            <>
              <Text type="body" size="sm" weight="medium">
                {selected.size} selected
              </Text>
              <Button
                variant="ghost"
                size="sm"
                icon={<Trash2 />}
                label="Remove"
                onClick={removeSelected}
              />
              <Button
                variant="ghost"
                size="sm"
                label="Cancel"
                onClick={() => setSelected(new Set())}
              />
            </>
          ) : (
            <Text type="body" size="sm" color="secondary">
              {list.entries.length} {list.entries.length === 1 ? "member" : "members"}
            </Text>
          )}
        </HStack>
        <Button size="sm" icon={<Plus />} label="Add member" onClick={() => setAdding(true)} />
      </HStack>

      {adding && (
        <Card variant="muted" padding={3}>
          <VStack gap={3}>
            <TextInput
              {...AUTOFILL_OFF}
              label="Username"
              isRequired
              size="sm"
              value={draft.username}
              onChange={(v) => setDraft({ ...draft, username: v })}
              placeholder="alice.chen"
              hasAutoFocus
            />
            <VStack gap={1}>
              <HStack gap={2} vAlign="end">
                <TextInput
                  {...AUTOFILL_OFF}
                  label="Password"
                  isRequired
                  size="sm"
                  value={draft.password}
                  onChange={(v) => setDraft({ ...draft, password: v })}
                  placeholder="auto-generate or paste"
                  width="100%"
                />
                <IconButton
                  variant="secondary"
                  size="sm"
                  label="Generate a strong password"
                  tooltip="Generate strong password"
                  icon={<Sparkles />}
                  onClick={() => setDraft((d) => ({ ...d, password: genPassword() }))}
                />
              </HStack>
              {draft.password && (
                // ProgressBar replaces a hand-sized coloured sliver that
                // conveyed strength by width and colour alone.
                <ProgressBar
                  label={`Password strength: ${strength.label}`}
                  value={(strength.score / 5) * 100}
                  variant={strength.variant}
                  hasValueLabel
                  formatValueLabel={() => strength.label}
                />
              )}
            </VStack>
            <HStack gap={2} justify="end">
              <Button
                variant="secondary"
                size="sm"
                label="Cancel"
                onClick={() => {
                  setAdding(false);
                  setDraft({ username: "", password: "" });
                }}
              />
              <Button
                size="sm"
                label="Add"
                onClick={submitNew}
                isLoading={submitting}
                isDisabled={!draft.username.trim() || !draft.password || submitting}
              />
            </HStack>
          </VStack>
        </Card>
      )}

      {list.entries.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title="No members yet"
          description="Add the first credentials. Anyone using this list to reach a proxy host will be denied until at least one account exists."
          actions={
            <Button
              size="sm"
              icon={<Plus />}
              label="Add the first member"
              onClick={() => setAdding(true)}
            />
          }
        />
      ) : (
        <Table data={rows} columns={columns} idKey="id" hasHover plugins={{ selection }} />
      )}
    </VStack>
  );
}

// --- Settings Tab ---

function SettingsTab({
  list,
  usageCount,
  onListUpdated,
  onDeleted,
}: {
  list: AccessList;
  usageCount: number;
  onListUpdated: (list: AccessList) => void;
  onDeleted: () => void;
}) {
  const [name, setName] = useState(list.name);
  const [desc, setDesc] = useState(list.description || "");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Switching to a different list that happens to share a name and description
  // must still reset the form and clear the confirm field, so the effect keys on
  // the id as well even though it does not read it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: list.id is deliberate
  useEffect(() => {
    setName(list.name);
    setDesc(list.description || "");
    setConfirm("");
  }, [list.id, list.name, list.description]);

  const dirty = name !== list.name || (desc || "") !== (list.description || "");

  const save = async () => {
    setSaving(true);
    try {
      const updated = await updateAccessListAction(list.id, {
        name: name.trim() || list.name,
        description: desc.trim() || null,
      });
      onListUpdated(updated);
      toast.success("Saved");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteAccessListAction(list.id);
      toast.success(`Deleted "${list.name}"`);
      onDeleted();
    } finally {
      setDeleting(false);
    }
  };

  const confirmMismatch = confirm.length > 0 && confirm !== list.name;

  return (
    <VStack gap={6} maxWidth={672}>
      <VStack gap={3}>
        <TextInput label="Name" isRequired size="sm" value={name} onChange={setName} />
        <TextArea
          label="Description"
          isOptional
          size="sm"
          value={desc}
          onChange={setDesc}
          rows={3}
          placeholder="What is this list for? Who manages it?"
        />
        <HStack gap={2} vAlign="center">
          <Button
            size="sm"
            label="Save changes"
            onClick={save}
            isLoading={saving}
            isDisabled={!dirty || !name.trim() || saving}
          />
          {dirty && (
            <Button
              variant="ghost"
              size="sm"
              label="Discard"
              onClick={() => {
                setName(list.name);
                setDesc(list.description || "");
              }}
            />
          )}
        </HStack>
      </VStack>

      <Card padding={3}>
        <MetadataList>
          <MetadataListItem label="Created">{fmtDate(list.createdAt)}</MetadataListItem>
          <MetadataListItem label="Last updated">{fmtRelative(list.updatedAt)}</MetadataListItem>
          <MetadataListItem label="List ID">
            <Text type="code" size="sm">
              {list.id}
            </Text>
          </MetadataListItem>
        </MetadataList>
      </Card>

      <Banner
        status="error"
        icon={<AlertTriangle />}
        title="Danger zone"
        description="Delete this access list"
        defaultIsExpanded
      >
        <VStack gap={3}>
          <Text type="body" size="xsm" color="secondary">
            {usageCount > 0
              ? `This list is currently used by ${usageCount} proxy ${usageCount === 1 ? "host" : "hosts"}. Those hosts will be left without authentication.`
              : "Once deleted, the credentials cannot be recovered."}
          </Text>
          <TextInput
            {...AUTOFILL_OFF}
            label={`Type ${list.name} to confirm`}
            size="sm"
            value={confirm}
            onChange={setConfirm}
            placeholder={list.name}
            width={448}
            status={confirmMismatch ? { type: "error", message: "Name does not match" } : undefined}
          />
          <HStack>
            <Button
              variant="destructive"
              size="sm"
              icon={<Trash2 />}
              label="Delete list permanently"
              isLoading={deleting}
              isDisabled={confirm !== list.name || deleting}
              onClick={handleDelete}
            />
          </HStack>
        </VStack>
      </Banner>
    </VStack>
  );
}

// --- Usage Tab ---

function UsageTab({ hosts }: { hosts: AccessListUsage[] }) {
  if (hosts.length === 0) {
    return (
      <EmptyState
        icon={<Globe />}
        title="Not used by any proxy host"
        description="This list is currently dormant. You can keep it for later, or delete it from Settings."
      />
    );
  }

  return (
    <VStack gap={3}>
      <Text type="body" size="sm" color="secondary">
        This access list guards {hosts.length} proxy {hosts.length === 1 ? "host" : "hosts"}.
        Removing the list, or any of its members, will affect access to these hosts.
      </Text>
      <List hasDividers>
        {hosts.map((h) => (
          <ListItem
            key={h.id}
            startContent={<Icon icon={Globe} size="sm" color="secondary" />}
            label={h.domains[0] ?? h.name}
            description={
              h.domains.length > 1
                ? `+${h.domains.length - 1} more domain${h.domains.length - 1 > 1 ? "s" : ""}`
                : undefined
            }
            endContent={
              <Badge
                variant={h.enabled ? "success" : "neutral"}
                label={h.enabled ? "active" : "disabled"}
              />
            }
          />
        ))}
      </List>
    </VStack>
  );
}

// --- Detail Pane ---

type DetailTab = "members" | "usage" | "settings";

function DetailPane({
  list,
  usage,
  onListUpdated,
  onDeleted,
}: {
  list: AccessList | null;
  usage: AccessListUsage[];
  onListUpdated: (list: AccessList) => void;
  onDeleted: () => void;
}) {
  const [tab, setTab] = useState<DetailTab>("members");

  if (!list) {
    return (
      <EmptyState
        icon={<KeyRound />}
        title="Select an access list"
        description="Pick one from the list on the left, or create a new one."
      />
    );
  }

  return (
    <VStack gap={4}>
      <HStack gap={4} vAlign="start">
        <Icon icon={KeyRound} color="accent" />
        <VStack gap={1}>
          <Heading level={2} maxLines={1}>
            {list.name}
          </Heading>
          <Text type="body" size="sm" color="secondary">
            {list.description || "No description"}
          </Text>
          <HStack gap={2} wrap="wrap" vAlign="center">
            <Badge
              icon={<Users />}
              label={`${list.entries.length} ${list.entries.length === 1 ? "member" : "members"}`}
            />
            <Badge
              icon={<Globe />}
              label={`${usage.length} ${usage.length === 1 ? "host" : "hosts"}`}
            />
            <Badge icon={<Clock />} label={`updated ${fmtRelative(list.updatedAt)}`} />
            {usage.length === 0 && <Badge variant="warning" label="unused" />}
          </HStack>
        </VStack>
      </HStack>

      <TabList value={tab} onChange={(v) => setTab(v as DetailTab)} size="sm" hasDivider>
        <Tab
          value="members"
          label="Members"
          icon={<Users />}
          endContent={<Badge label={list.entries.length} />}
        />
        <Tab
          value="usage"
          label="Used by"
          icon={<Globe />}
          endContent={<Badge label={usage.length} />}
        />
        <Tab value="settings" label="Settings" icon={<Settings2 />} />
      </TabList>

      {tab === "members" && <MembersTab list={list} onListUpdated={onListUpdated} />}
      {tab === "usage" && <UsageTab hosts={usage} />}
      {tab === "settings" && (
        <SettingsTab
          list={list}
          usageCount={usage.length}
          onListUpdated={onListUpdated}
          onDeleted={onDeleted}
        />
      )}
    </VStack>
  );
}

// --- New List Dialog ---

type SeedMember = { username: string; password: string };

function blankSeedMember(): WithRowId<SeedMember> {
  return withRowId({ username: "", password: "" });
}

function NewListDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (list: AccessList) => void;
}) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [seed, setSeed] = useState<WithRowId<SeedMember>[]>(() => [blankSeedMember()]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setName("");
      setDesc("");
      setSeed([blankSeedMember()]);
    }
  }, [open]);

  const valid = name.trim().length > 0;

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    try {
      const list = await createAccessListAction({
        name: name.trim(),
        description: desc.trim() || null,
        users: seed
          .filter((s) => s.username.trim() && s.password)
          .map(({ username, password }) => ({ username, password })),
      });
      onCreate(list);
      onClose();
      toast.success(`Created "${list.name}"`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppDialog
      open={open}
      onClose={onClose}
      title="New access list"
      maxWidth="lg"
      submitLabel="Create list"
      onSubmit={submit}
      isSubmitting={submitting}
      isSubmitDisabled={!name.trim()}
    >
      <VStack gap={4}>
        <Text type="body" size="sm" color="secondary">
          Define a set of credentials you can attach to one or more proxy hosts.
        </Text>

        <TextInput
          label="Name"
          isRequired
          size="sm"
          value={name}
          onChange={setName}
          placeholder="e.g. Internal — Engineering"
          hasAutoFocus
        />
        <TextInput
          label="Description"
          isOptional
          size="sm"
          value={desc}
          onChange={setDesc}
          placeholder="What is this list for?"
        />

        <VStack gap={2}>
          <Text type="label" size="xsm" color="secondary">
            Seed members (optional)
          </Text>
          {seed.map((s, i) => (
            <HStack key={s.rowId} gap={2} vAlign="end">
              <TextInput
                {...AUTOFILL_OFF}
                label={`Username for seed member ${i + 1}`}
                isLabelHidden
                size="sm"
                value={s.username}
                onChange={(v) =>
                  setSeed(seed.map((x) => (x.rowId === s.rowId ? { ...x, username: v } : x)))
                }
                placeholder="username"
                width="100%"
              />
              <TextInput
                {...AUTOFILL_OFF}
                label={`Password for seed member ${i + 1}`}
                isLabelHidden
                size="sm"
                value={s.password}
                onChange={(v) =>
                  setSeed(seed.map((x) => (x.rowId === s.rowId ? { ...x, password: v } : x)))
                }
                placeholder="password"
                width="100%"
              />
              <IconButton
                variant="secondary"
                size="sm"
                label={`Generate a password for seed member ${i + 1}`}
                tooltip="Generate password"
                icon={<Sparkles />}
                onClick={() =>
                  setSeed(
                    seed.map((x) => (x.rowId === s.rowId ? { ...x, password: genPassword() } : x)),
                  )
                }
              />
              <IconButton
                variant="ghost"
                size="sm"
                label={`Remove seed member ${i + 1}`}
                tooltip="Remove"
                icon={<X />}
                onClick={() =>
                  setSeed(
                    seed.length === 1
                      ? [blankSeedMember()]
                      : seed.filter((x) => x.rowId !== s.rowId),
                  )
                }
              />
            </HStack>
          ))}
          <HStack>
            <Button
              variant="ghost"
              size="sm"
              icon={<Plus />}
              label="Add another member"
              onClick={() => setSeed([...seed, blankSeedMember()])}
            />
          </HStack>
        </VStack>
      </VStack>
    </AppDialog>
  );
}

// --- Lists Rail (left sidebar) ---

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "recent", label: "Recent" },
  { value: "name", label: "Name" },
  { value: "members", label: "Members" },
  { value: "usage", label: "Usage" },
];

function ListsRail({
  lists,
  selectedId,
  onSelect,
  onNew,
  query,
  setQuery,
  sort,
  setSort,
  usage,
}: {
  lists: AccessList[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onNew: () => void;
  query: string;
  setQuery: (q: string) => void;
  sort: SortKey;
  setSort: (s: SortKey) => void;
  usage: Record<number, AccessListUsage[]>;
}) {
  const filtered = useMemo(() => {
    let arr = lists.slice();
    const q = query.trim().toLowerCase();
    if (q) {
      arr = arr.filter(
        (l) =>
          l.name.toLowerCase().includes(q) ||
          (l.description || "").toLowerCase().includes(q) ||
          l.entries.some((e) => e.username.toLowerCase().includes(q)),
      );
    }
    arr.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "members") return b.entries.length - a.entries.length;
      if (sort === "recent")
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      if (sort === "usage") return (usage[b.id]?.length ?? 0) - (usage[a.id]?.length ?? 0);
      return 0;
    });
    return arr;
  }, [lists, query, sort, usage]);

  return (
    <VStack gap={3} padding={3}>
      <HStack justify="between" vAlign="center" gap={2}>
        <VStack gap={0}>
          <Heading level={1}>Access Lists</Heading>
          <Text type="body" size="xsm" color="secondary">
            {lists.length} {lists.length === 1 ? "list" : "lists"} · HTTP basic auth
          </Text>
        </VStack>
        <Button size="sm" icon={<Plus />} label="New" onClick={onNew} />
      </HStack>

      <HStack gap={2} vAlign="center">
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search lists or members..."
          label="Search access lists"
          width="100%"
        />
        <Kbd keys="mod+K" />
      </HStack>

      <SegmentedControl
        label="Sort access lists"
        size="sm"
        layout="fill"
        value={sort}
        onChange={(v) => setSort(v as SortKey)}
      >
        {SORT_OPTIONS.map((o) => (
          <SegmentedControlItem key={o.value} value={o.value} label={o.label} />
        ))}
      </SegmentedControl>

      {filtered.length === 0 ? (
        <EmptyState
          title={`No lists match "${query}"`}
          isCompact
          actions={
            <Button variant="ghost" size="sm" label="Clear search" onClick={() => setQuery("")} />
          }
        />
      ) : (
        <List>
          {filtered.map((list) => {
            const hostCount = usage[list.id]?.length ?? 0;
            return (
              <ListItem
                key={list.id}
                isSelected={list.id === selectedId}
                startContent={
                  <Icon
                    icon={KeyRound}
                    size="sm"
                    color={list.id === selectedId ? "accent" : "secondary"}
                  />
                }
                label={list.name}
                description={`${list.entries.length} ${list.entries.length === 1 ? "member" : "members"} · ${hostCount} ${hostCount === 1 ? "host" : "hosts"}`}
                endContent={
                  hostCount === 0 ? <Badge variant="warning" label="unused" /> : undefined
                }
                onClick={() => onSelect(list.id)}
              />
            );
          })}
        </List>
      )}
    </VStack>
  );
}

// --- Main Client Component ---

export default function AccessListsClient({ lists: initialLists, usage: initialUsage }: Props) {
  const router = useRouter();
  const [lists, setLists] = useState(initialLists);
  const [usage, setUsage] = useState(initialUsage);
  const [selectedId, setSelectedId] = useState<number | null>(initialLists[0]?.id ?? null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [newOpen, setNewOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  // Sync from server props when they change (e.g. after revalidation)
  useEffect(() => {
    setLists(initialLists);
    setUsage(initialUsage);
  }, [initialLists, initialUsage]);

  const selected = lists.find((l) => l.id === selectedId) ?? null;

  const handleListUpdated = useCallback(
    (updated: AccessList) => {
      setLists((ls) => ls.map((l) => (l.id === updated.id ? updated : l)));
      router.refresh();
    },
    [router],
  );

  const handleDeleted = useCallback(() => {
    setLists((ls) => ls.filter((l) => l.id !== selectedId));
    setSelectedId(lists.find((l) => l.id !== selectedId)?.id ?? null);
    router.refresh();
  }, [selectedId, lists, router]);

  const handleCreated = useCallback(
    (list: AccessList) => {
      setLists((ls) => [list, ...ls]);
      setSelectedId(list.id);
      router.refresh();
    },
    [router],
  );

  // Keyboard shortcuts: ⌘K focuses search, N creates. Both were previously
  // wired to a raw input ref; the search box is a component now, so the
  // shortcut focuses the input inside its wrapper.
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.querySelector("input")?.focus();
        return;
      }
      const tgt = e.target as HTMLElement;
      if (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA") return;
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        setNewOpen(true);
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <>
      <Layout
        height="fill"
        start={
          <LayoutPanel width={320} hasDivider role="navigation" label="Access lists">
            <div ref={searchRef}>
              <ListsRail
                lists={lists}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onNew={() => setNewOpen(true)}
                query={query}
                setQuery={setQuery}
                sort={sort}
                setSort={setSort}
                usage={usage}
              />
            </div>
          </LayoutPanel>
        }
        content={
          <LayoutContent padding={6}>
            <DetailPane
              list={selected}
              usage={usage[selectedId ?? -1] ?? []}
              onListUpdated={handleListUpdated}
              onDeleted={handleDeleted}
            />
          </LayoutContent>
        }
      />

      <NewListDialog open={newOpen} onClose={() => setNewOpen(false)} onCreate={handleCreated} />
    </>
  );
}
