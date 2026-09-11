import { useMemo } from "react";
import AuditLogClient from "@cpm/controller/src/app/(dashboard)/audit-log/AuditLogClient";
import { useSearchParams } from "../shims/next-navigation";
import { DemoSurface } from "../DemoSurface";

const PER_PAGE = 5;

/** A day of ordinary changes, written the way the log writes them. */
const EVENTS = [
  {
    id: 9,
    action: "update",
    entityType: "proxy_host",
    createdAt: "2026-02-11T16:42:07.000Z",
    user: "avery",
    summary: "Enabled the WAF on grafana.example.com",
  },
  {
    id: 8,
    action: "waf.rule_suppressed",
    entityType: "waf_rule",
    createdAt: "2026-02-11T15:03:55.000Z",
    user: "avery",
    summary: "Suppressed rule 942100 for grafana.example.com",
  },
  {
    id: 7,
    action: "update",
    entityType: "proxy_host",
    createdAt: "2026-02-11T11:20:31.000Z",
    user: "sam",
    summary: "Added upstream http://app-2:8080 to app.example.com",
  },
  {
    id: 6,
    action: "create",
    entityType: "l4_proxy_host",
    createdAt: "2026-02-10T19:55:02.000Z",
    user: "sam",
    summary: "Created L4 proxy host postgres (5432/tcp)",
  },
  {
    id: 5,
    action: "create",
    entityType: "client_certificate",
    createdAt: "2026-02-10T14:12:48.000Z",
    user: "avery",
    summary: "Issued client certificate backup-runner",
  },
  {
    id: 4,
    action: "revoke",
    entityType: "client_certificate",
    createdAt: "2026-02-09T09:31:10.000Z",
    user: "avery",
    summary: "Revoked client certificate old-laptop",
  },
  {
    id: 3,
    action: "config.applied",
    entityType: "agent",
    createdAt: "2026-02-08T22:07:19.000Z",
    user: "ci",
    summary: "Applied configuration to agent edge-fra",
  },
  {
    id: 2,
    action: "update",
    entityType: "proxy_host",
    createdAt: "2026-02-08T08:44:03.000Z",
    user: "avery",
    summary: "Blocked continent AF on app.example.com",
  },
  {
    id: 1,
    action: "create",
    entityType: "proxy_host",
    createdAt: "2026-02-07T17:26:40.000Z",
    user: "avery",
    summary: "Created proxy host app.example.com",
  },
];

/**
 * The activity strip and tiles the page opens with, derived from the rows above the way the server
 * derives them from the table: the 24 hours ending at the newest event, bucketed by hour, with the
 * gaps filled so every hour has a bar.
 */
const NEWEST = Math.max(...EVENTS.map((event) => new Date(event.createdAt).getTime()));
const WINDOW_START = NEWEST - 23 * 60 * 60 * 1000;
const IN_WINDOW = EVENTS.filter((event) => new Date(event.createdAt).getTime() >= WINDOW_START);
const ACTIVITY = Array.from({ length: 24 }, (_, index) => {
  const key = new Date(WINDOW_START + index * 60 * 60 * 1000).toISOString().slice(0, 13);
  return {
    label: `${key.slice(11)}:00 UTC`,
    count: IN_WINDOW.filter((event) => event.createdAt.slice(0, 13) === key).length,
  };
});
const SUMMARY = {
  events: IN_WINDOW.length,
  actors: new Set(IN_WINDOW.map((event) => event.user)).size,
  entityTypes: new Set(IN_WINDOW.map((event) => event.entityType)).size,
};

/**
 * The audit log page itself, searching and paging for real.
 *
 * In the app the server answers each new query string; here this component does, off the rows
 * above. Nothing else changes - the search field, the table and the pager are the ones shipped.
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
        activity={ACTIVITY}
        summary={SUMMARY}
      />
    </DemoSurface>
  );
}
