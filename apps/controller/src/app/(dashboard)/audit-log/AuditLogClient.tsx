"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@astryxdesign/core/Badge";
import { Card } from "@astryxdesign/core/Card";
import { Text } from "@astryxdesign/core/Text";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { SearchField } from "@/components/ui/SearchField";
import { PageHeader } from "@/components/ui/PageHeader";
import { formatDateTimeUtc } from "@/src/lib/date-format";

type EventRow = {
  id: number;
  createdAt: string;
  user: string;
  summary: string;
};

type Props = {
  events: EventRow[];
  pagination: { total: number; page: number; perPage: number };
  initialSearch: string;
};

export default function AuditLogClient({ events, pagination, initialSearch }: Props) {
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
      label: "Time (UTC)",
      width: 180,
      render: (r) => (
        <Text type="body" size="sm" color="secondary">
          {formatDateTimeUtc(r.createdAt)}
        </Text>
      ),
    },
    {
      id: "user",
      label: "User",
      width: 160,
      render: (r) => <Badge label={r.user} />,
    },
    {
      id: "summary",
      label: "Event",
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
      <PageHeader title="Audit Log" description="Review configuration changes and user activity." />

      <HStack gap={2} vAlign="center">
        <SearchField
          value={searchTerm}
          onChange={(next) => {
            setSearchTerm(next);
            updateSearch(next);
          }}
          placeholder="Search audit log..."
        />
      </HStack>

      <DataTable
        columns={columns}
        data={events}
        keyField="id"
        emptyMessage="No audit events found"
        pagination={pagination}
        mobileCard={mobileCard}
      />
    </VStack>
  );
}
