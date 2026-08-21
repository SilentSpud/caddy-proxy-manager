"use client";

import { useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Card } from "@astryxdesign/core/Card";
import { Switch } from "@astryxdesign/core/Switch";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Text } from "@astryxdesign/core/Text";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { ProxyHost } from "@/lib/models/proxy-hosts";

export function DnsResolverFields({
  dnsResolver,
}: {
  dnsResolver?: ProxyHost["dnsResolver"] | null;
}) {
  const initial = dnsResolver ?? null;
  const [enabled, setEnabled] = useState(initial?.enabled ?? false);
  const [resolvers, setResolvers] = useState(initial?.resolvers?.join("\n") ?? "");
  const [fallbacks, setFallbacks] = useState(initial?.fallbacks?.join("\n") ?? "");
  const [timeout, setTimeout] = useState(initial?.timeout ?? "");

  return (
    <Card>
      <input type="hidden" name="dnsPresent" value="1" />
      <input type="hidden" name="dnsEnabledPresent" value="1" />

      <VStack gap={4}>
        <HStack justify="between" vAlign="center" gap={4}>
          <VStack gap={1}>
            <Text type="body" size="sm" weight="semibold">
              Custom DNS Resolvers
            </Text>
            <Text type="body" size="sm" color="secondary">
              Configure per-host DNS resolution for upstream discovery and health checks
            </Text>
          </VStack>
          <Switch
            label="Enable custom DNS resolvers"
            isLabelHidden
            htmlName="dnsEnabled"
            value={enabled}
            onChange={setEnabled}
          />
        </HStack>

        {/* Unmounted rather than collapsed behind max-h-0/opacity-0, so hidden
            fields are not focusable and are not submitted. */}
        {enabled && (
          <VStack gap={5}>
            <TextArea
              label="DNS Resolvers"
              htmlName="dnsResolvers"
              placeholder={"1.1.1.1\n8.8.8.8"}
              value={resolvers}
              onChange={setResolvers}
              rows={2}
              description="One resolver per line (e.g., 1.1.1.1, 8.8.8.8). Used for dynamic upstream DNS resolution."
            />
            <TextArea
              label="Fallback DNS Resolvers"
              isOptional
              htmlName="dnsFallbacks"
              placeholder={"8.8.4.4\n1.0.0.1"}
              value={fallbacks}
              onChange={setFallbacks}
              rows={2}
              description="Fallback resolvers if primary fails. One per line."
            />
            <TextInput
              label="DNS Query Timeout"
              htmlName="dnsTimeout"
              placeholder="5s"
              value={timeout}
              onChange={setTimeout}
              description="Timeout for DNS queries (e.g., 5s, 10s)"
            />
            <Banner
              status="info"
              title="Per-host resolvers override global DNS settings"
              description="Useful for upstream services that require specific DNS resolution, such as internal DNS or service discovery. Common resolvers: 1.1.1.1 (Cloudflare), 8.8.8.8 (Google), 9.9.9.9 (Quad9)."
            />
          </VStack>
        )}
      </VStack>
    </Card>
  );
}
