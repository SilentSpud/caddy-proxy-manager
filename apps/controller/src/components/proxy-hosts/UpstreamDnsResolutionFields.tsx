"use client";

import { useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Card } from "@astryxdesign/core/Card";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/Stack";
import type { ProxyHost } from "@/lib/models/proxy-hosts";
import { useTranslations } from "next-intl";

type ResolutionMode = "inherit" | "enabled" | "disabled";
type FamilyMode = "inherit" | "ipv6" | "ipv4" | "both";

const MODE_OPTIONS = [
  { value: "inherit", label: "Inherit Global" },
  { value: "enabled", label: "Enabled" },
  { value: "disabled", label: "Disabled" },
];

const FAMILY_OPTIONS = [
  { value: "inherit", label: "Inherit Global" },
  { value: "both", label: "Both (Prefer IPv6)" },
  { value: "ipv6", label: "IPv6 only" },
  { value: "ipv4", label: "IPv4 only" },
];

function toResolutionMode(enabled: boolean | null | undefined): ResolutionMode {
  if (enabled === true) return "enabled";
  if (enabled === false) return "disabled";
  return "inherit";
}

function toFamilyMode(family: "ipv6" | "ipv4" | "both" | null | undefined): FamilyMode {
  if (family === "ipv6" || family === "ipv4" || family === "both") {
    return family;
  }
  return "inherit";
}

export function UpstreamDnsResolutionFields({
  upstreamDnsResolution,
}: {
  upstreamDnsResolution?: ProxyHost["upstreamDnsResolution"] | null;
}) {
  const t = useTranslations("proxyHosts");
  const mode = toResolutionMode(upstreamDnsResolution?.enabled);
  const family = toFamilyMode(upstreamDnsResolution?.family);
  const [currentMode, setCurrentMode] = useState<ResolutionMode>(mode);
  const [currentFamily, setCurrentFamily] = useState<FamilyMode>(family);

  const summary =
    currentMode === "inherit" && currentFamily === "inherit"
      ? "Using global upstream DNS pinning defaults"
      : `Override: ${currentMode === "inherit" ? "inherit mode" : currentMode}, ${
          currentFamily === "inherit" ? "inherit family" : currentFamily
        }`;

  return (
    <Card>
      <input type="hidden" name="upstreamDnsResolutionPresent" value="1" />

      {/* Collapsible owns the disclosure, replacing a hand-rotated chevron and a
          max-height/opacity transition that left hidden fields focusable. */}
      <Collapsible
        defaultIsOpen={mode !== "inherit" || family !== "inherit"}
        trigger={
          <VStack gap={1} hAlign="start">
            <Text type="body" size="sm" weight="semibold">
              {t("upstreamDnsPinning")}
            </Text>
            <Text type="body" size="sm" color="secondary">
              {summary}
            </Text>
          </VStack>
        }
      >
        <VStack gap={4}>
          <input type="hidden" name="upstreamDnsResolutionMode" value={currentMode} />
          <Selector
            label={t("resolutionMode")}
            options={MODE_OPTIONS}
            value={currentMode}
            onChange={(next) => setCurrentMode(next as ResolutionMode)}
            description={t("inheritUsesTheGlobal")}
          />

          <input type="hidden" name="upstreamDnsResolutionFamily" value={currentFamily} />
          <Selector
            label={t("addressFamilyPreference")}
            options={FAMILY_OPTIONS}
            value={currentFamily}
            onChange={(next) => setCurrentFamily(next as FamilyMode)}
            description={t("bothResolvesAaaaA")}
          />

          <Banner
            status="info"
            title={t("hostnameUpstreamsAreResolved")}
            description={t("whenEnabledHostnameUpstreams")}
          />
        </VStack>
      </Collapsible>
    </Card>
  );
}
