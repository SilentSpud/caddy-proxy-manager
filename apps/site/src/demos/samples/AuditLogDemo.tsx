import { useMemo } from "react";
import AuditLogClient from "@cpm/controller/src/app/(dashboard)/audit-log/AuditLogClient";
import { useSearchParams } from "../shims/next-navigation";
import { DemoSurface } from "../DemoSurface";

const PER_PAGE = 5;

/** A day of ordinary changes, written the way the log writes them. */
const EVENTS = [
  {
    id: 9,
    createdAt: "2026-02-11T16:42:07.000Z",
    user: "avery",
    summary: "Enabled the WAF on grafana.example.com",
  },
  {
    id: 8,
    createdAt: "2026-02-11T15:03:55.000Z",
    user: "avery",
    summary: "Suppressed rule 942100 for grafana.example.com",
  },
  {
    id: 7,
    createdAt: "2026-02-11T11:20:31.000Z",
    user: "sam",
    summary: "Added upstream http://app-2:8080 to app.example.com",
  },
  {
    id: 6,
    createdAt: "2026-02-10T19:55:02.000Z",
    user: "sam",
    summary: "Created L4 proxy host postgres (5432/tcp)",
  },
  {
    id: 5,
    createdAt: "2026-02-10T14:12:48.000Z",
    user: "avery",
    summary: "Issued client certificate backup-runner",
  },
  {
    id: 4,
    createdAt: "2026-02-09T09:31:10.000Z",
    user: "avery",
    summary: "Revoked client certificate old-laptop",
  },
  {
    id: 3,
    createdAt: "2026-02-08T22:07:19.000Z",
    user: "ci",
    summary: "Applied configuration to agent edge-fra",
  },
  {
    id: 2,
    createdAt: "2026-02-08T08:44:03.000Z",
    user: "avery",
    summary: "Blocked continent AF on app.example.com",
  },
  {
    id: 1,
    createdAt: "2026-02-07T17:26:40.000Z",
    user: "avery",
    summary: "Created proxy host app.example.com",
  },
];

/**
 * The audit log page itself, searching and paging for real.
 *
 * In the app the server answers each new query string; here this component does, off the rows
 * above. Nothing else changes — the search field, the table and the pager are the ones shipped.
 */
export default function AuditLogDemo() {
  const params = useSearchParams();
  const search = params.get("search") ?? "";
  const page = Math.max(1, Number(params.get("page")) || 1);

  const matches = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return EVENTS;
    return EVENTS.filter((e) => `${e.user} ${e.summary}`.toLowerCase().includes(needle));
  }, [search]);

  return (
    <DemoSurface>
      <AuditLogClient
        events={matches.slice((page - 1) * PER_PAGE, page * PER_PAGE)}
        pagination={{ total: matches.length, page, perPage: PER_PAGE }}
        initialSearch={search}
      />
    </DemoSurface>
  );
}
