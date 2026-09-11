"use client";

/**
 * One country's slice of the traffic, opened by choosing it on the map or in the table.
 *
 * The map and the table answer "where is traffic coming from"; this answers the follow-up neither
 * can - to what, and how it was answered. Every figure is a column the access log actually records
 * (host, status, user agent, client IP); there is no ASN or network column, so there is no
 * breakdown by network.
 */

import { useEffect, useState } from "react";
import { Card } from "@astryxdesign/core/Card";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Grid } from "@astryxdesign/core/Grid";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Spinner } from "@astryxdesign/core/Spinner";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";

export type CountryBreakdownData = {
  countryCode: string;
  total: number;
  blocked: number;
  uniqueIps: number;
  hosts: { host: string; count: number }[];
  statusClasses: { ok: number; redirects: number; clientErrors: number; serverErrors: number };
  userAgents: { userAgent: string; count: number }[];
};

type Row = { label: string; count: number };

/** A labelled count with a bar scaled to the largest in its list. */
function RankedList({ title, rows, color }: { title: string; rows: Row[]; color: string }) {
  const top = rows.reduce((max, row) => Math.max(max, row.count), 0);
  return (
    <VStack gap={2}>
      <Text type="supporting" color="secondary">
        {title}
      </Text>
      {rows.map((row) => (
        <VStack key={row.label} gap={1}>
          <HStack gap={2} vAlign="center" justify="between">
            <Text type="body" size="sm" maxLines={1}>
              {row.label}
            </Text>
            <Text type="code" size="xsm" color="secondary" hasTabularNumbers>
              {row.count.toLocaleString()}
            </Text>
          </HStack>
          <div
            aria-hidden="true"
            style={{
              height: 4,
              borderRadius: 999,
              background: "var(--color-border)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: top > 0 ? `${(row.count / top) * 100}%` : 0,
                height: "100%",
                background: color,
              }}
            />
          </div>
        </VStack>
      ))}
    </VStack>
  );
}

export function CountryBreakdown({
  code,
  query,
  totalRequests,
  onClose,
}: {
  code: string;
  /** The page's current range and host filter, as the query string every analytics call shares. */
  query: string;
  /** Everything in the range, so the header can say what share of it this country is. */
  totalRequests: number;
  onClose: () => void;
}) {
  const t = useTranslations("analytics");
  const [data, setData] = useState<CountryBreakdownData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(false);
    fetch(`/api/analytics/country${query}&code=${encodeURIComponent(code)}`)
      .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
      .then((body: CountryBreakdownData) => {
        if (!cancelled) setData(body);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [code, query]);

  // Intl rather than a hand-kept table, so the name follows the reader's locale. "XX" is the code
  // for requests GeoIP could not place, which no locale has a name for.
  const name =
    code === "XX"
      ? t("unplacedCountry")
      : (new Intl.DisplayNames(undefined, { type: "region" }).of(code) ?? code);
  const share = totalRequests > 0 && data ? ((data.total / totalRequests) * 100).toFixed(1) : null;

  return (
    <Card padding={5} data-testid="country-breakdown">
      <VStack gap={4}>
        <HStack gap={3} vAlign="center" justify="between">
          <HStack gap={3} vAlign="center" wrap="wrap">
            <Text type="body" weight="semibold">
              {name}
            </Text>
            {data && (
              <Text type="supporting" color="secondary">
                {t("breakdownSummary", {
                  requests: data.total.toLocaleString(),
                  share: share ?? "0",
                  uniqueIps: data.uniqueIps.toLocaleString(),
                  blocked: data.blocked.toLocaleString(),
                })}
              </Text>
            )}
          </HStack>
          <IconButton
            variant="ghost"
            size="sm"
            icon={<X />}
            label={t("closeBreakdown")}
            tooltip={t("closeBreakdown")}
            onClick={onClose}
          />
        </HStack>

        {error ? (
          <EmptyState title={t("breakdownLoadError")} isCompact />
        ) : !data ? (
          <HStack justify="center" vAlign="center" height={120}>
            <Spinner label={t("loadingBreakdown")} />
          </HStack>
        ) : data.total === 0 ? (
          <EmptyState title={t("noTrafficRecorded")} isCompact />
        ) : (
          <Grid columns={{ minWidth: 220, max: 3 }} gap={6}>
            <RankedList
              title={t("breakdownHosts")}
              rows={data.hosts.map((h) => ({ label: h.host, count: h.count }))}
              color="var(--color-data-blue-3)"
            />
            <RankedList
              title={t("breakdownResponses")}
              rows={[
                { label: "2xx", count: data.statusClasses.ok },
                { label: "3xx", count: data.statusClasses.redirects },
                { label: "4xx", count: data.statusClasses.clientErrors },
                { label: "5xx", count: data.statusClasses.serverErrors },
              ]}
              color="var(--color-data-categorical-teal)"
            />
            <RankedList
              title={t("topUserAgents")}
              rows={data.userAgents.map((u) => ({ label: u.userAgent, count: u.count }))}
              color="var(--color-border-emphasized)"
            />
          </Grid>
        )}
      </VStack>
    </Card>
  );
}
