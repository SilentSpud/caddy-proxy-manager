import OverviewClient from "@cpm/controller/src/app/(dashboard)/OverviewClient";
import { DemoSurface } from "../DemoSurface";

/**
 * The dashboard's own landing page, which is what the product looks like on an ordinary morning.
 * It takes every number as a prop and imports no server action, so it runs here unchanged — the
 * stat cards, the traffic bar and the activity list are the components that ship.
 */
export default function OverviewDemo() {
  return (
    <DemoSurface>
      <OverviewClient
        userName="Avery"
        stats={[
          { label: "Proxy hosts", icon: "proxyHosts", count: 12, href: "#" },
          { label: "Certificates", icon: "certificates", count: 9, href: "#" },
          { label: "Access lists", icon: "accessLists", count: 3, href: "#" },
        ]}
        trafficSummary={{ totalRequests: 48219, blockedPercent: 0.8 }}
        recentEvents={[
          {
            id: 9,
            summary: "Enabled the WAF on grafana.example.com",
            createdAt: "2026-02-11T16:42:07.000Z",
          },
          {
            id: 8,
            summary: "Added upstream http://app-2:8080 to app.example.com",
            createdAt: "2026-02-11T11:20:31.000Z",
          },
          {
            id: 7,
            summary: "Created L4 proxy host postgres (5432/tcp)",
            createdAt: "2026-02-10T19:55:02.000Z",
          },
          {
            id: 6,
            summary: "Issued client certificate backup-runner",
            createdAt: "2026-02-10T14:12:48.000Z",
          },
          {
            id: 5,
            summary: "Removed old-laptop from the Staging access list",
            createdAt: "2026-02-09T09:31:10.000Z",
          },
        ]}
      />
    </DemoSurface>
  );
}
