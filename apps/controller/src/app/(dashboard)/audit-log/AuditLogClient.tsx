"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@astryxdesign/core/Badge";
import { Card } from "@astryxdesign/core/Card";
import { Text } from "@astryxdesign/core/Text";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { SearchField } from "@/components/ui/SearchField";
import { ListPageHeader } from "@/components/ui/ListPageHeader";
import { StatTiles } from "@/components/ui/StatTiles";
import { ActivityStrip, type ActivityBucket } from "@/components/ui/ActivityStrip";
import { formatDateTimeUtc } from "@/src/lib/date-format";
import { useTranslations } from "next-intl";

type EventRow = {
  id: number;
  createdAt: string;
  user: string;
  action: string;
  entityType: string;
  summary: string;
};

type Props = {
  events: EventRow[];
  pagination: { total: number; page: number; perPage: number };
  initialSearch: string;
  /** 24 hourly buckets covering the last day of the whole log, search or no search. */
  activity: ActivityBucket[];
  summary: { events: number; actors: number; entityTypes: number };
};

export default function AuditLogClient({
  events,
  pagination,
  initialSearch,
  activity,
  summary,
}: Props) {
  const t = useTranslations("auditLog");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [searchTerm, setSearchTerm] = useState(initialSearch);
  useEffect(() => {
    setSearchTerm(initialSearch);
  }, [initialSearch]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateSearch = useCallback(
    (value: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const params = new URLSearchParams(searchParams.toString());
        if (value.trim()) {
          params.set("search", value.trim());
        } else {
          params.delete("search");
        }
        params.delete("page"); // reset to page 1 on new search
        router.push(`${pathname}?${params.toString()}`);
      }, 400);
    },
    [router, pathname, searchParams],
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const columns: Column<EventRow>[] = [
    {
      id: "created_at",
      label: t("timeUtc"),
      width: 180,
      render: (r) => (
        <Text type="body" size="sm" color="secondary">
          {formatDateTimeUtc(r.createdAt)}
        </Text>
      ),
    },
    {
      id: "user",
      label: t("user"),
      width: 160,
      render: (r) => <Badge label={r.user} />,
    },
    {
      id: "resource",
      label: t("resource"),
      width: 200,
      render: (r) => (
        <VStack gap={0}>
          <Text type="body" size="sm">
            {r.entityType}
          </Text>
          <Text type="code" size="xsm" color="secondary">
            {r.action}
          </Text>
        </VStack>
      ),
    },
    {
      id: "summary",
      label: t("event"),
      render: (r) => (
        <Text type="body" size="sm">
          {r.summary}
        </Text>
      ),
    },
  ];

  const mobileCard = (r: EventRow) => (
    <Card>
      <VStack gap={1}>
        <HStack justify="between" vAlign="center" gap={2}>
          <Badge label={r.user} />
          <Text type="body" size="xsm" color="secondary">
            {formatDateTimeUtc(r.createdAt)}
          </Text>
        </HStack>
        <Text type="body" size="sm">
          {r.summary}
        </Text>
      </VStack>
    </Card>
  );

  return (
    <VStack gap={6}>
      <ListPageHeader
        title={t("auditLog")}
        description={t("pageDescription")}
        stats={
          <StatTiles
            tiles={[
              {
                id: "day",
                label: t("eventsLastDay"),
                value: summary.events,
                note: t("actorsNote", { count: summary.actors }),
              },
              {
                id: "kinds",
                label: t("resourceKinds"),
                value: summary.entityTypes,
                note: t("resourceKindsNote"),
              },
              {
                id: "total",
                label: t("eventsRecorded"),
                value: pagination.total,
                note: t("matchingNote"),
              },
            ]}
          />
        }
        summary={
          <Card padding={4}>
            <ActivityStrip
              buckets={activity}
              title={t("activityTitle")}
              describePeak={(bucket) =>
                t("activityPeak", { label: bucket.label, count: bucket.count })
              }
            />
          </Card>
        }
        search={
          <SearchField
            value={searchTerm}
            onChange={(next) => {
              setSearchTerm(next);
              updateSearch(next);
            }}
            placeholder={t("searchAuditLog")}
          />
        }
      />

      <DataTable
        columns={columns}
        data={events}
        keyField="id"
        emptyMessage={t("noAuditEventsFound")}
        pagination={pagination}
        mobileCard={mobileCard}
      />
    </VStack>
  );
}
