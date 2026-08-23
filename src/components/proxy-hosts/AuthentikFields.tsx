"use client";

import { useEffect, useState } from "react";
import { Card } from "@astryxdesign/core/Card";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { Switch } from "@astryxdesign/core/Switch";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Text } from "@astryxdesign/core/Text";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import type { AuthentikSettings } from "@/lib/settings";
import type { ProxyHost } from "@/lib/models/proxy-hosts";

const AUTHENTIK_DEFAULT_HEADERS = [
  "X-Authentik-Username",
  "X-Authentik-Groups",
  "X-Authentik-Entitlements",
  "X-Authentik-Email",
  "X-Authentik-Name",
  "X-Authentik-Uid",
  "X-Authentik-Jwt",
  "X-Authentik-Meta-Jwks",
  "X-Authentik-Meta-Outpost",
  "X-Authentik-Meta-Provider",
  "X-Authentik-Meta-App",
  "X-Authentik-Meta-Version",
];

const AUTHENTIK_DEFAULT_TRUSTED_PROXIES = ["private_ranges"];

function getAuthentikFormDefaults(
  authentik: ProxyHost["authentik"] | null,
  defaults: AuthentikSettings | null | undefined,
) {
  return {
    enabled: authentik?.enabled ?? false,
    outpostDomain: authentik?.outpostDomain ?? defaults?.outpostDomain ?? "",
    outpostUpstream: authentik?.outpostUpstream ?? defaults?.outpostUpstream ?? "",
    authEndpoint: authentik?.authEndpoint ?? defaults?.authEndpoint ?? "",
    copyHeaders:
      authentik && authentik.copyHeaders.length > 0
        ? authentik.copyHeaders.join("\n")
        : AUTHENTIK_DEFAULT_HEADERS.join("\n"),
    trustedProxies:
      authentik && authentik.trustedProxies.length > 0
        ? authentik.trustedProxies.join("\n")
        : AUTHENTIK_DEFAULT_TRUSTED_PROXIES.join("\n"),
    setHostHeader: authentik?.setOutpostHostHeader ?? true,
  };
}

export function AuthentikFields({
  authentik,
  defaults,
}: {
  authentik?: ProxyHost["authentik"] | null;
  /**
   * Global Authentik defaults, used to prefill blank fields. Required (rather
   * than optional) so a call site cannot silently omit it: the edit dialog did
   * exactly that, leaving existing hosts without defaults while new hosts got
   * them (#232). Pass `null` explicitly when there are no defaults.
   */
  defaults: AuthentikSettings | null;
}) {
  const initial = authentik ?? null;
  const [enabled, setEnabled] = useState(false);
  const [outpostDomain, setOutpostDomain] = useState("");
  const [outpostUpstream, setOutpostUpstream] = useState("");
  const [authEndpoint, setAuthEndpoint] = useState("");
  const [copyHeadersValue, setCopyHeadersValue] = useState("");
  const [trustedProxiesValue, setTrustedProxiesValue] = useState("");
  const [setHostHeader, setSetHostHeader] = useState(true);
  const [protectedPaths, setProtectedPaths] = useState(initial?.protectedPaths?.join(", ") ?? "");
  const [excludedPaths, setExcludedPaths] = useState(initial?.excludedPaths?.join(", ") ?? "");

  useEffect(() => {
    const next = getAuthentikFormDefaults(initial, defaults);
    setEnabled(next.enabled);
    setOutpostDomain(next.outpostDomain);
    setOutpostUpstream(next.outpostUpstream);
    setAuthEndpoint(next.authEndpoint);
    setCopyHeadersValue(next.copyHeaders);
    setTrustedProxiesValue(next.trustedProxies);
    setSetHostHeader(next.setHostHeader);
  }, [initial, defaults]);

  return (
    <Card>
      <input type="hidden" name="authentikPresent" value="1" />
      <input type="hidden" name="authentikEnabledPresent" value="1" />
      <input type="hidden" name="authentikEnabled" value={enabled ? "true" : "false"} />
      {/* Rendered unconditionally, as before: the action reads this marker to
          decide whether to write setOutpostHostHeader at all, and the previous
          markup kept it in the DOM even while the section was collapsed. */}
      <input type="hidden" name="authentikSetHostHeaderPresent" value="1" />

      <VStack gap={4}>
        <HStack justify="between" vAlign="center" gap={4}>
          <VStack gap={1}>
            <Text type="body" size="sm" weight="semibold">
              Authentik Forward Auth
            </Text>
            <Text type="body" size="sm" color="secondary">
              Proxy authentication via Authentik outpost
            </Text>
          </VStack>
          <Switch
            label="Enable Authentik forward auth"
            isLabelHidden
            value={enabled}
            onChange={setEnabled}
          />
        </HStack>

        {/* Unmounted when off. Previously these stayed mounted but `disabled`
            inside a max-h-0 wrapper — disabled controls are omitted from
            FormData, so the submitted payload is unchanged, and they are no
            longer reachable by keyboard while hidden. */}
        {enabled && (
          <VStack gap={4}>
            <TextInput
              label="Outpost Domain"
              htmlName="authentikOutpostDomain"
              placeholder="outpost.goauthentik.io"
              value={outpostDomain}
              onChange={setOutpostDomain}
              isRequired
            />
            <TextInput
              label="Outpost Upstream URL"
              htmlName="authentikOutpostUpstream"
              placeholder="https://outpost.internal:9000"
              value={outpostUpstream}
              onChange={setOutpostUpstream}
              isRequired
            />
            <TextInput
              label="Auth Endpoint"
              isOptional
              htmlName="authentikAuthEndpoint"
              placeholder="/outpost.goauthentik.io/auth/caddy"
              value={authEndpoint}
              onChange={setAuthEndpoint}
            />
            <TextArea
              label="Headers to Copy"
              htmlName="authentikCopyHeaders"
              value={copyHeadersValue}
              onChange={setCopyHeadersValue}
              rows={3}
            />
            <TextInput
              label="Trusted Proxies"
              htmlName="authentikTrustedProxies"
              value={trustedProxiesValue}
              onChange={setTrustedProxiesValue}
            />
            <TextArea
              label="Protected Paths"
              isOptional
              htmlName="authentikProtectedPaths"
              placeholder="/secret/*, /admin/*"
              value={protectedPaths}
              onChange={setProtectedPaths}
              rows={2}
              description="Leave empty to protect entire domain. Specify paths to protect specific routes only."
            />
            <TextArea
              label="Excluded Paths"
              isOptional
              htmlName="authentikExcludedPaths"
              placeholder="/share/*, /rest/*"
              value={excludedPaths}
              onChange={setExcludedPaths}
              rows={2}
              description="Paths to exclude from authentication. These paths bypass forward auth while all other paths remain protected. Ignored if Protected Paths is set."
            />

            <VStack gap={1}>
              <CheckboxInput
                label="Set Host Header for Outpost"
                description="Recommended: keep enabled. Only disable if using IP-based outpost access or troubleshooting routing issues."
                htmlName="authentikSetHostHeader"
                value={setHostHeader}
                onChange={setSetHostHeader}
              />
            </VStack>
          </VStack>
        )}
      </VStack>
    </Card>
  );
}
