"use client";

import { ReactNode, useCallback, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowUpDown, ArrowUp, ArrowDown, ChevronRight } from "lucide-react";
import {
  Table,
  pixel,
  proportional,
  useTableRowExpansion,
  useTableRowStatus,
  type TableColumn,
  type TableRowStatus,
} from "@astryxdesign/core/Table";
import { Button } from "@astryxdesign/core/Button";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Card } from "@astryxdesign/core/Card";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Pagination } from "@astryxdesign/core/Pagination";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Stack";
import { useMediaQuery } from "@astryxdesign/core/hooks";

export type Column<T> = {
  id: string;
  label: string;
  align?: "left" | "right" | "center";
  width?: string | number;
  sortKey?: string;
  render?: (row: T) => ReactNode;
};

export type { TableRowStatus };

/** Row shape Astryx's Table works in; see the note in DataTable below. */
type TableRow = Record<string, unknown>;

type DataTableProps<T> = {
  columns: Column<T>[];
  data: T[];
  keyField: keyof T;
  emptyMessage?: string;
  loading?: boolean;
  /** Renders a trailing "open" control on each row, rather than a bare row click. */
  onRowClick?: (row: T) => void;
  /**
   * Per-row status indicator. Replaces the old rowClassName, which tinted rows
   * with hardcoded colours that conveyed meaning by colour alone.
   */
  rowStatus?: (row: T) => TableRowStatus | null;
  pagination?: {
    total: number;
    page: number;
    perPage: number;
  };
  sort?: { sortBy: string; sortDir: "asc" | "desc" };
  mobileCard?: (row: T) => ReactNode;
  /**
   * Detail panel shown below a row when it is expanded. Supplying this adds the
   * expand chevron column; the open set is owned here, since no caller so far
   * needs to drive it from outside.
   */
  expandedRow?: (row: T) => ReactNode;
};

const SKELETON_ROWS = 5;
const SKELETON_CARDS = 3;

const ALIGN: Record<NonNullable<Column<unknown>["align"]>, "start" | "center" | "end"> = {
  left: "start",
  center: "center",
  right: "end",
};

function toColumnWidth(width: Column<unknown>["width"]) {
  if (typeof width === "number") return pixel(width);
  if (typeof width === "string") {
    const parsed = Number.parseInt(width, 10);
    if (Number.isFinite(parsed)) return pixel(parsed);
  }
  return proportional(1);
}

function PaginationBar({ page, perPage, total }: { page: number; perPage: number; total: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (Math.ceil(total / perPage) <= 1) return null;

  return (
    <Pagination
      page={page}
      pageSize={perPage}
      totalItems={total}
      onChange={(nextPage) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set("page", String(nextPage));
        router.push(`${pathname}?${params.toString()}`);
      }}
    />
  );
}

/**
 * A column heading that toggles sort order through the URL.
 *
 * The table's own sortable plugin sorts client-side; this app sorts on the
 * server and carries the order in the query string, so the heading stays a
 * plain control that pushes a new URL.
 */
function SortableHeader<T>({
  col,
  sort,
}: {
  col: Column<T>;
  sort?: { sortBy: string; sortDir: "asc" | "desc" };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (!col.sortKey) return <>{col.label}</>;

  const isActive = sort?.sortBy === col.sortKey;
  const nextDir = isActive && sort?.sortDir === "asc" ? "desc" : "asc";

  return (
    <Button
      variant="ghost"
      size="sm"
      label={col.label}
      endContent={isActive ? (sort?.sortDir === "asc" ? <ArrowUp /> : <ArrowDown />) : <ArrowUpDown />}
      onClick={() => {
        const params = new URLSearchParams(searchParams.toString());
        params.set("sortBy", col.sortKey!);
        params.set("sortDir", nextDir);
        params.set("page", "1");
        router.push(`${pathname}?${params.toString()}`);
      }}
    />
  );
}

export function DataTable<T>({
  columns,
  data,
  keyField,
  emptyMessage = "No data available",
  loading = false,
  onRowClick,
  rowStatus,
  pagination,
  sort,
  mobileCard,
  expandedRow,
}: DataTableProps<T>) {
  const isEmpty = data.length === 0 && !loading;
  // Replaces the paired `block md:hidden` / `hidden md:block` wrappers, so only
  // one of the two views is ever mounted.
  const isNarrow = useMediaQuery("(max-width: 767px)");

  // Astryx's Table requires rows to carry an index signature. The app's domain
  // types are plain interfaces, so the cast is confined to this boundary rather
  // than pushed onto every model as `extends Record<string, unknown>`.
  const getStatus = useCallback(
    (row: TableRow) => (rowStatus ? rowStatus(row as T) : null),
    [rowStatus]
  );
  const statusPlugin = useTableRowStatus<TableRow>({ getStatus });

  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set());
  const expansionPlugin = useTableRowExpansion<TableRow>({
    expandedKeys,
    onToggle: useCallback((key: string) => {
      setExpandedKeys((prev) => {
        const next = new Set(prev);
        if (!next.delete(key)) next.add(key);
        return next;
      });
    }, []),
    getRowKey: useCallback((row: TableRow) => String(row[keyField as string]), [keyField]),
    renderExpanded: useCallback(
      (row: TableRow) => (expandedRow ? expandedRow(row as T) : null),
      [expandedRow]
    ),
  });

  const plugins = {
    ...(rowStatus ? { rowStatus: statusPlugin } : {}),
    ...(expandedRow ? { expansion: expansionPlugin } : {}),
  };

  const tableColumns: TableColumn<TableRow>[] = columns.map((col) => ({
    key: col.id,
    header: <SortableHeader col={col} sort={sort} />,
    width: toColumnWidth(col.width),
    align: col.align ? ALIGN[col.align] : undefined,
    renderCell: col.render
      ? (row: TableRow) => col.render!(row as T)
      : (row: TableRow) => row[col.id] as ReactNode,
  }));

  if (onRowClick) {
    // The old table opened a row on click, which no keyboard user could reach.
    // An explicit trailing control keeps the affordance and makes it focusable.
    tableColumns.push({
      key: "__open",
      header: "",
      width: pixel(48),
      align: "end",
      resizable: false,
      renderCell: (row: TableRow) => (
        <IconButton
          variant="ghost"
          size="sm"
          label="View details"
          icon={<ChevronRight />}
          onClick={() => onRowClick(row as T)}
        />
      ),
    });
  }

  if (mobileCard && isNarrow) {
    return (
      <VStack gap={3}>
        {loading ? (
          Array.from({ length: SKELETON_CARDS }).map((_, index) => (
            <Card key={`skeleton-${index}`}>
              <Skeleton height={80} />
            </Card>
          ))
        ) : isEmpty ? (
          <Card>
            <EmptyState title={emptyMessage} isCompact />
          </Card>
        ) : (
          data.map((row) => <VStack key={String(row[keyField])}>{mobileCard(row)}</VStack>)
        )}
        {pagination && <PaginationBar {...pagination} />}
      </VStack>
    );
  }

  if (isEmpty) {
    return (
      <Card>
        <EmptyState title={emptyMessage} />
      </Card>
    );
  }

  return (
    <VStack gap={4}>
      {loading ? (
        <VStack gap={2}>
          {Array.from({ length: SKELETON_ROWS }).map((_, index) => (
            <Skeleton key={`skeleton-${index}`} height={40} />
          ))}
        </VStack>
      ) : (
        <Table
          data={data as readonly unknown[] as TableRow[]}
          columns={tableColumns}
          idKey={String(keyField)}
          hasHover
          plugins={Object.keys(plugins).length > 0 ? plugins : undefined}
        />
      )}
      {pagination && <PaginationBar {...pagination} />}
    </VStack>
  );
}
