/**
 * Writing analytics events, and nothing else.
 *
 * The agent inserts its own events rather than shipping them to the controller: a controller on
 * another host cannot read this host's Caddy log at all, and relaying every request through it
 * would put the busiest write path in the fleet through a machine with nothing to do with it.
 *
 * Insert-only on purpose. The controller owns the schema, the retention policy and every read —
 * this side knows two table names and how to append rows to them.
 */

import { type ClickHouseClient, createClient } from "@clickhouse/client";
import type { FleetConfig, TrafficEventRow, WafEventRow } from "@cpm/shared";

type Credentials = NonNullable<FleetConfig["clickhouse"]>;

let client: ClickHouseClient | null = null;
let current: Credentials | null = null;

/** Whether analytics are configured at all. Everything below is a no-op when they are not. */
export function analyticsEnabled(): boolean {
  return current !== null;
}

/**
 * Point the writer at a ClickHouse, or switch it off.
 *
 * Reconnecting only on a real change keeps a periodic config push from tearing down a working
 * connection every time it arrives.
 */
export async function configureAnalytics(credentials: Credentials | null): Promise<void> {
  const same =
    current !== null &&
    credentials !== null &&
    current.url === credentials.url &&
    current.user === credentials.user &&
    current.password === credentials.password &&
    current.database === credentials.database;
  if (same) return;

  await closeAnalytics();
  current = credentials;
  if (!credentials) {
    console.log("[analytics] disabled — no ClickHouse credentials");
    return;
  }
  console.log(`[analytics] writing to ${credentials.url} as ${credentials.user}`);
}

function getClient(): ClickHouseClient {
  if (!current) throw new Error("Analytics are not configured.");
  if (!client) {
    client = createClient({
      url: current.url,
      username: current.user,
      password: current.password,
      database: current.database,
    });
  }
  return client;
}

export async function closeAnalytics(): Promise<void> {
  if (!client) return;
  const closing = client;
  client = null;
  try {
    await closing.close();
  } catch (error) {
    // A connection that will not close cleanly is not worth failing a reconfiguration over.
    console.warn("[analytics] failed to close the ClickHouse connection:", error);
  }
}

/** ClickHouse's DateTime literal, from the Unix seconds Caddy logs. */
function toDateTime(seconds: number): string {
  return new Date(seconds * 1000).toISOString().replace("T", " ").slice(0, 19);
}

export async function insertTrafficEvents(rows: TrafficEventRow[]): Promise<void> {
  if (!current || rows.length === 0) return;
  await getClient().insert({
    table: "traffic_events",
    values: rows.map((row) => ({
      ...row,
      ts: toDateTime(row.ts),
      // ClickHouse's UInt8 column, not a bool.
      is_blocked: row.is_blocked ? 1 : 0,
    })),
    format: "JSONEachRow",
  });
}

export async function insertWafEvents(rows: WafEventRow[]): Promise<void> {
  if (!current || rows.length === 0) return;
  await getClient().insert({
    table: "waf_events",
    values: rows.map((row) => ({
      ...row,
      ts: toDateTime(row.ts),
      blocked: row.blocked ? 1 : 0,
    })),
    format: "JSONEachRow",
  });
}
