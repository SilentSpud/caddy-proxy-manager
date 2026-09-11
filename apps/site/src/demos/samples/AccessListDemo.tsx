import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Badge } from "@astryxdesign/core/Badge";
import { Card } from "@astryxdesign/core/Card";
import { ClickableCard } from "@astryxdesign/core/ClickableCard";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { useTranslations } from "next-intl";
import { Text } from "@astryxdesign/core/Text";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { DataTable, type Column } from "@cpm/controller/src/components/ui/DataTable";
import { DemoSurface } from "../DemoSurface";

type Member = { id: number; username: string; addedAt: string };
type UsedBy = { id: number; domain: string };
type List = { id: number; name: string; description: string; members: Member[]; usedBy: UsedBy[] };

const LISTS: List[] = [
  {
    id: 1,
    name: "Staging",
    description: "Everything not meant for the public yet",
    members: [
      { id: 1, username: "avery", addedAt: "04/01/2026" },
      { id: 2, username: "sam", addedAt: "04/01/2026" },
      { id: 3, username: "priya", addedAt: "22/01/2026" },
    ],
    usedBy: [
      { id: 1, domain: "staging.example.com" },
      { id: 2, domain: "preview.example.com" },
    ],
  },
  {
    id: 2,
    name: "Ops tools",
    description: "Grafana and the status page",
    members: [
      { id: 4, username: "avery", addedAt: "04/01/2026" },
      { id: 5, username: "oncall", addedAt: "17/02/2026" },
    ],
    usedBy: [{ id: 3, domain: "grafana.example.com" }],
  },
  {
    id: 3,
    name: "Vendor",
    description: "A contractor, for as long as the contract lasts",
    members: [{ id: 6, username: "vendor-acme", addedAt: "02/03/2026" }],
    usedBy: [],
  },
];

const MEMBER_COLUMNS: Column<Member>[] = [
  {
    id: "username",
    label: "Username",
    render: (r) => (
      <Text type="code" size="sm">
        {r.username}
      </Text>
    ),
  },
  {
    id: "addedAt",
    label: "Added",
    width: 120,
    render: (r) => (
      <Text type="body" size="sm" color="secondary">
        {r.addedAt}
      </Text>
    ),
  },
  {
    id: "remove",
    label: "",
    width: 60,
    align: "right",
    render: () => <IconButton variant="ghost" size="sm" icon={<Trash2 />} label="Remove member" />,
  },
];

/**
 * The two-pane shape of the access lists page: pick a list on the left, and its members and the
 * hosts it protects fill the right. Passwords are bcrypt-hashed on save, so nothing here shows one.
 */
function AccessListDemoContent() {
  const t = useTranslations("accessLists");
  const [selectedId, setSelectedId] = useState(1);
  const [tab, setTab] = useState("members");
  const selected = LISTS.find((list) => list.id === selectedId) ?? LISTS[0];
  if (!selected) return null;

  return (
    <VStack gap={4}>
      <VStack gap={2}>
        {LISTS.map((list) => (
          <ClickableCard
            key={list.id}
            label={list.name}
            // The selected list is the one filling the pane below, so it takes a tint and the
            // others sit on the plain surface.
            variant={list.id === selectedId ? "blue" : "default"}
            onClick={() => setSelectedId(list.id)}
          >
            <HStack justify="between" vAlign="center" gap={3}>
              <VStack gap={0}>
                <Text type="body" size="sm" weight="semibold">
                  {list.name}
                </Text>
                <Text type="body" size="xsm" color="secondary">
                  {list.description}
                </Text>
              </VStack>
              <HStack gap={2} vAlign="center">
                <Badge label={`${list.members.length} members`} />
                <Badge
                  variant={list.usedBy.length > 0 ? "info" : "neutral"}
                  label={`${list.usedBy.length} hosts`}
                />
              </HStack>
            </HStack>
          </ClickableCard>
        ))}
        {/* The totals the page's rail ends with, for the whole set rather than the list in view. */}
        <Text type="supporting" color="secondary">
          {t("railSummary", {
            lists: LISTS.length,
            members: LISTS.reduce((sum, list) => sum + list.members.length, 0),
          })}
        </Text>
      </VStack>

      <TabList value={tab} onChange={setTab}>
        <Tab value="members" label="Members" />
        <Tab value="usedBy" label="Used by" />
      </TabList>

      {tab === "members" ? (
        <DataTable
          columns={MEMBER_COLUMNS}
          data={selected.members}
          keyField="id"
          emptyMessage="No members yet"
        />
      ) : (
        <Card>
          {selected.usedBy.length === 0 ? (
            <Text type="body" size="sm" color="secondary">
              No proxy hosts use this list. It can be deleted safely.
            </Text>
          ) : (
            <VStack gap={2}>
              {selected.usedBy.map((host) => (
                <Text key={host.id} type="code" size="sm">
                  {host.domain}
                </Text>
              ))}
            </VStack>
          )}
        </Card>
      )}
    </VStack>
  );
}

/**
 * The content renders inside DemoSurface rather than around it: the surface is what provides the
 * message catalog, and the content reads from it with useTranslations.
 */
export default function AccessListDemo() {
  return (
    <DemoSurface>
      <AccessListDemoContent />
    </DemoSurface>
  );
}
