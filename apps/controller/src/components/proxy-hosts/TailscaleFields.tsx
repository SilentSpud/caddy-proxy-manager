"use client";

import { useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Card } from "@astryxdesign/core/Card";
import { Code } from "@astryxdesign/core/Code";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Text } from "@astryxdesign/core/Text";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import type { ProxyHost } from "@/lib/models/proxy-hosts";
import { CheckboxInput, Switch } from "@/src/components/ui/FormBooleanControls";
import { ModuleGated, useDisabledReason } from "@/components/caddy-modules/ModuleGate";
import { useTranslations } from "next-intl";

export type TailscaleHostDefaults = {
  /** Whether Tailscale is switched on in Settings at all. */
  enabled: boolean;
  /** Whether an auth key is stored. Without one the node cannot register, and the apply fails. */
  hasAuthKey: boolean;
  /** The node a host inherits when it names none. */
  defaultNode: string;
};

/**
 * One proxy host's Tailscale options.
 *
 * `serve` is the switch the identity options hang off, because neither works without it: the gate
 * needs a tsnet listener to ask who is calling, and "tailnet only" has nothing to be exclusive of.
 * Dialling an upstream over the tailnet is genuinely independent — a host published on the public
 * internet can still proxy to a machine that only exists on the tailnet — so it sits outside.
 */
export function TailscaleFields({
  tailscale,
  defaults,
}: {
  tailscale?: ProxyHost["tailscale"] | null;
  defaults?: TailscaleHostDefaults | null;
}) {
  const t = useTranslations("proxyHosts");
  const initial = tailscale ?? null;
  const [serve, setServe] = useState(initial?.serve ?? false);
  const [node, setNode] = useState(initial?.node ?? "");
  const [tailnetOnly, setTailnetOnly] = useState(initial?.tailnetOnly ?? true);
  const [auth, setAuth] = useState(initial?.auth ?? false);
  const [protectedPaths, setProtectedPaths] = useState(initial?.protected_paths?.join(", ") ?? "");
  const [excludedPaths, setExcludedPaths] = useState(initial?.excluded_paths?.join(", ") ?? "");
  const [forwardIdentity, setForwardIdentity] = useState(initial?.forwardIdentity ?? false);
  const [upstreamNode, setUpstreamNode] = useState(initial?.upstreamNode ?? "");

  const moduleDisabledReason = useDisabledReason("tailscale");
  const placeholderNode = defaults?.defaultNode || "caddy";
  const settingsOff = defaults ? !defaults.enabled : false;
  const usesTailscale = serve || upstreamNode.trim() !== "";
  const noAuthKey = defaults ? !defaults.hasAuthKey : false;

  return (
    <Card>
      <input type="hidden" name="tailscalePresent" value="1" />

      <VStack gap={4}>
        <HStack justify="between" vAlign="center" gap={4}>
          <VStack gap={1}>
            <Text type="body" size="sm" weight="semibold">
              {t("tailscale")}{" "}
            </Text>
            <Text type="body" size="sm" color="secondary">
              {t("tailscaleDescription")}
            </Text>
          </VStack>
          <ModuleGated feature="tailscale">
            <Switch
              label={t("serveOnTailnet")}
              isLabelHidden
              htmlName="tailscaleServe"
              value={serve}
              onChange={setServe}
              isDisabled={Boolean(moduleDisabledReason)}
            />
          </ModuleGated>
        </HStack>

        {moduleDisabledReason && <Banner status="warning" title={moduleDisabledReason} />}

        {usesTailscale && settingsOff && (
          <Banner
            status="warning"
            title={t("tailscaleDisabledTitle")}
            description={t("tailscaleDisabledDescription")}
          />
        )}

        {usesTailscale && noAuthKey && (
          <Banner
            status="error"
            title={t("tailscaleAuthKeyMissingTitle")}
            description={t("tailscaleAuthKeyMissingDescription")}
          />
        )}

        {serve && (
          <VStack gap={4}>
            <TextInput
              label={t("nodeName")}
              isOptional
              htmlName="tailscaleNode"
              value={node}
              onChange={setNode}
              placeholder={placeholderNode}
              description={`The tailnet machine this host is served on. Empty uses "${placeholderNode}" from Settings → Tailscale. Several hosts can share one node.`}
            />
            <Banner
              status="info"
              title={t("tailscaleDomainRequirementTitle")}
              description={`Routing is still by Host header, so a request to https://${node || placeholderNode}.your-tailnet.ts.net only reaches this host if that name is one of its domains. Caddy gets the certificate for it from Tailscale — no ACME, no DNS provider.`}
            />
            <CheckboxInput
              label={t("tailnetOnly")}
              description={t("tailnetOnlyHelp")}
              htmlName="tailscaleTailnetOnly"
              value={tailnetOnly}
              onChange={setTailnetOnly}
            />
            <CheckboxInput
              label={t("requireATailscaleIdentity")}
              description={t("tailscaleIdentityHelp")}
              htmlName="tailscaleAuth"
              value={auth}
              onChange={setAuth}
            />
            {auth && (
              <VStack gap={4}>
                <TextArea
                  label={t("protectedPaths")}
                  isOptional
                  htmlName="tailscaleProtectedPaths"
                  placeholder="/admin/*"
                  value={protectedPaths}
                  onChange={setProtectedPaths}
                  rows={2}
                  description={t("identityProtectedPathsHelp")}
                />
                <TextArea
                  label={t("excludedPaths")}
                  isOptional
                  htmlName="tailscaleExcludedPaths"
                  placeholder="/healthz, /metrics"
                  value={excludedPaths}
                  onChange={setExcludedPaths}
                  rows={2}
                  description={t("tailscaleExcludedPathsHelp")}
                />
                <CheckboxInput
                  label={t("forwardTheIdentityUpstream")}
                  description={t("tailscaleForwardIdentityHelp")}
                  htmlName="tailscaleForwardIdentity"
                  value={forwardIdentity}
                  onChange={setForwardIdentity}
                />
              </VStack>
            )}
          </VStack>
        )}

        <ModuleGated feature="tailscale">
          <TextInput
            label={t("tailscaleUpstreamNodeLabel")}
            isOptional
            htmlName="tailscaleUpstreamNode"
            value={upstreamNode}
            onChange={setUpstreamNode}
            placeholder={placeholderNode}
            isDisabled={Boolean(moduleDisabledReason)}
            description={t("tailscaleUpstreamNodeHelp")}
          />
        </ModuleGated>

        {upstreamNode.trim() !== "" && (
          <Text type="body" size="sm" color="secondary">
            Upstreams are dialled through <Code>{upstreamNode.trim()}</Code>. Use a MagicDNS name or
            a tailnet IP in the Upstreams field above.
          </Text>
        )}
      </VStack>
    </Card>
  );
}
