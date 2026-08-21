"use client";

import { useState } from "react";
import { Card } from "@astryxdesign/core/Card";
import { NumberInput } from "@astryxdesign/core/NumberInput";
import { Selector } from "@astryxdesign/core/Selector";
import { Switch } from "@astryxdesign/core/Switch";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Text } from "@astryxdesign/core/Text";
import { Grid } from "@astryxdesign/core/Grid";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { ProxyHost, LoadBalancingPolicy } from "@/lib/models/proxy-hosts";

const LOAD_BALANCING_POLICIES = [
  { value: "random", label: "Random", description: "Random selection (default)" },
  { value: "round_robin", label: "Round Robin", description: "Sequential distribution" },
  { value: "least_conn", label: "Least Connections", description: "Fewest active connections" },
  { value: "ip_hash", label: "IP Hash", description: "Client IP-based sticky sessions" },
  { value: "first", label: "First Available", description: "First available upstream" },
  { value: "header", label: "Header Hash", description: "Hash based on request header" },
  { value: "cookie", label: "Cookie", description: "Cookie-based sticky sessions" },
  { value: "uri_hash", label: "URI Hash", description: "URI path-based distribution" },
];

/**
 * Every value is held in one state object because Astryx inputs are controlled,
 * where these were uncontrolled `defaultValue` fields. `htmlName` on each input
 * keeps the submitted FormData keys byte-identical to before.
 */
type TextFields = {
  policyHeaderField: string;
  policyCookieName: string;
  policyCookieSecret: string;
  tryDuration: string;
  tryInterval: string;
  activeHealthUri: string;
  activeHealthInterval: string;
  activeHealthTimeout: string;
  activeHealthBody: string;
  passiveHealthFailDuration: string;
  passiveHealthUnhealthyStatus: string;
  passiveHealthUnhealthyLatency: string;
};

type NumberFields = {
  retries: number | null;
  activeHealthPort: number | null;
  activeHealthStatus: number | null;
  passiveHealthMaxFails: number | null;
};

export function LoadBalancerFields({
  loadBalancer,
}: {
  loadBalancer?: ProxyHost["loadBalancer"] | null;
}) {
  const initial = loadBalancer ?? null;
  const [enabled, setEnabled] = useState(initial?.enabled ?? false);
  const [policy, setPolicy] = useState<LoadBalancingPolicy>(initial?.policy ?? "random");
  const [activeHealthEnabled, setActiveHealthEnabled] = useState(
    initial?.activeHealthCheck?.enabled ?? false
  );
  const [passiveHealthEnabled, setPassiveHealthEnabled] = useState(
    initial?.passiveHealthCheck?.enabled ?? false
  );

  const [text, setText] = useState<TextFields>({
    policyHeaderField: initial?.policyHeaderField ?? "",
    policyCookieName: initial?.policyCookieName ?? "",
    policyCookieSecret: initial?.policyCookieSecret ?? "",
    tryDuration: initial?.tryDuration ?? "",
    tryInterval: initial?.tryInterval ?? "",
    activeHealthUri: initial?.activeHealthCheck?.uri ?? "",
    activeHealthInterval: initial?.activeHealthCheck?.interval ?? "",
    activeHealthTimeout: initial?.activeHealthCheck?.timeout ?? "",
    activeHealthBody: initial?.activeHealthCheck?.body ?? "",
    passiveHealthFailDuration: initial?.passiveHealthCheck?.failDuration ?? "",
    passiveHealthUnhealthyStatus:
      initial?.passiveHealthCheck?.unhealthyStatus?.join(", ") ?? "",
    passiveHealthUnhealthyLatency: initial?.passiveHealthCheck?.unhealthyLatency ?? "",
  });

  const [numbers, setNumbers] = useState<NumberFields>({
    retries: initial?.retries ?? null,
    activeHealthPort: initial?.activeHealthCheck?.port ?? null,
    activeHealthStatus: initial?.activeHealthCheck?.status ?? null,
    passiveHealthMaxFails: initial?.passiveHealthCheck?.maxFails ?? null,
  });

  const setTextField = (key: keyof TextFields) => (value: string) =>
    setText((prev) => ({ ...prev, [key]: value }));
  const setNumberField = (key: keyof NumberFields) => (value: number | null) =>
    setNumbers((prev) => ({ ...prev, [key]: value }));

  return (
    <Card>
      <input type="hidden" name="lbPresent" value="1" />
      <input type="hidden" name="lbEnabledPresent" value="1" />

      <VStack gap={4}>
        <HStack justify="between" vAlign="center" gap={4}>
          <VStack gap={1}>
            <Text type="body" size="sm" weight="semibold">
              Load Balancer
            </Text>
            <Text type="body" size="sm" color="secondary">
              Configure load balancing and health checks for multiple upstreams
            </Text>
          </VStack>
          <Switch
            label="Enable load balancing"
            isLabelHidden
            htmlName="lbEnabled"
            value={enabled}
            onChange={setEnabled}
          />
        </HStack>

        {enabled && (
          <VStack gap={6}>
            <input type="hidden" name="lbPolicy" value={policy} />
            <Selector
              label="Selection Policy"
              options={LOAD_BALANCING_POLICIES}
              value={policy}
              onChange={(next) => setPolicy(next as LoadBalancingPolicy)}
            />

            {policy === "header" && (
              <TextInput
                label="Header Field Name"
                htmlName="lbPolicyHeaderField"
                placeholder="X-Custom-Header"
                value={text.policyHeaderField}
                onChange={setTextField("policyHeaderField")}
                description="The request header to hash for upstream selection"
              />
            )}

            {policy === "cookie" && (
              <VStack gap={4}>
                <TextInput
                  label="Cookie Name"
                  htmlName="lbPolicyCookieName"
                  placeholder="server_id"
                  value={text.policyCookieName}
                  onChange={setTextField("policyCookieName")}
                  description="Name of the cookie for sticky sessions"
                />
                <TextInput
                  label="Cookie Secret"
                  isOptional
                  htmlName="lbPolicyCookieSecret"
                  placeholder="your-secret-key"
                  value={text.policyCookieSecret}
                  onChange={setTextField("policyCookieSecret")}
                  description="Secret key for HMAC cookie signing"
                />
              </VStack>
            )}

            <VStack gap={2}>
              <Text type="body" size="sm" weight="semibold">
                Retry Settings
              </Text>
              <Grid columns={3} gap={4}>
                <TextInput
                  label="Try Duration"
                  htmlName="lbTryDuration"
                  placeholder="5s"
                  value={text.tryDuration}
                  onChange={setTextField("tryDuration")}
                  description="How long to try upstreams"
                />
                <TextInput
                  label="Try Interval"
                  htmlName="lbTryInterval"
                  placeholder="250ms"
                  value={text.tryInterval}
                  onChange={setTextField("tryInterval")}
                  description="Wait between attempts"
                />
                <NumberInput
                  label="Max Retries"
                  htmlName="lbRetries"
                  min={0}
                  isIntegerOnly
                  value={numbers.retries}
                  onChange={setNumberField("retries")}
                  description="Maximum retry attempts"
                />
              </Grid>
            </VStack>

            <Card variant="muted">
              <input type="hidden" name="lbActiveHealthEnabledPresent" value="1" />
              <VStack gap={4}>
                <Switch
                  label="Active Health Checks"
                  description="Periodically probe upstreams to check health"
                  htmlName="lbActiveHealthEnabled"
                  value={activeHealthEnabled}
                  onChange={setActiveHealthEnabled}
                />
                {activeHealthEnabled && (
                  <Grid columns={2} gap={4}>
                    <TextInput
                      label="Health Check URI"
                      htmlName="lbActiveHealthUri"
                      placeholder="/health"
                      value={text.activeHealthUri}
                      onChange={setTextField("activeHealthUri")}
                      description="Path to probe for health"
                    />
                    <NumberInput
                      label="Health Check Port"
                      htmlName="lbActiveHealthPort"
                      min={1}
                      max={65535}
                      isIntegerOnly
                      value={numbers.activeHealthPort}
                      onChange={setNumberField("activeHealthPort")}
                      description="Override upstream port"
                    />
                    <TextInput
                      label="Check Interval"
                      htmlName="lbActiveHealthInterval"
                      placeholder="30s"
                      value={text.activeHealthInterval}
                      onChange={setTextField("activeHealthInterval")}
                      description="How often to check"
                    />
                    <TextInput
                      label="Check Timeout"
                      htmlName="lbActiveHealthTimeout"
                      placeholder="5s"
                      value={text.activeHealthTimeout}
                      onChange={setTextField("activeHealthTimeout")}
                      description="Timeout for health probe"
                    />
                    <NumberInput
                      label="Expected Status Code"
                      htmlName="lbActiveHealthStatus"
                      min={100}
                      max={599}
                      isIntegerOnly
                      value={numbers.activeHealthStatus}
                      onChange={setNumberField("activeHealthStatus")}
                      description="Expected HTTP status"
                    />
                    <TextInput
                      label="Expected Body"
                      htmlName="lbActiveHealthBody"
                      placeholder="OK"
                      value={text.activeHealthBody}
                      onChange={setTextField("activeHealthBody")}
                      description="Expected response body"
                    />
                  </Grid>
                )}
              </VStack>
            </Card>

            <Card variant="muted">
              <input type="hidden" name="lbPassiveHealthEnabledPresent" value="1" />
              <VStack gap={4}>
                <Switch
                  label="Passive Health Checks"
                  description="Mark upstreams unhealthy based on response failures"
                  htmlName="lbPassiveHealthEnabled"
                  value={passiveHealthEnabled}
                  onChange={setPassiveHealthEnabled}
                />
                {passiveHealthEnabled && (
                  <Grid columns={2} gap={4}>
                    <TextInput
                      label="Fail Duration"
                      htmlName="lbPassiveHealthFailDuration"
                      placeholder="30s"
                      value={text.passiveHealthFailDuration}
                      onChange={setTextField("passiveHealthFailDuration")}
                      description="How long to remember failures"
                    />
                    <NumberInput
                      label="Max Failures"
                      htmlName="lbPassiveHealthMaxFails"
                      min={0}
                      isIntegerOnly
                      value={numbers.passiveHealthMaxFails}
                      onChange={setNumberField("passiveHealthMaxFails")}
                      description="Failures before marking unhealthy"
                    />
                    <TextInput
                      label="Unhealthy Status Codes"
                      htmlName="lbPassiveHealthUnhealthyStatus"
                      placeholder="500, 502, 503"
                      value={text.passiveHealthUnhealthyStatus}
                      onChange={setTextField("passiveHealthUnhealthyStatus")}
                      description="Comma-separated status codes"
                    />
                    <TextInput
                      label="Unhealthy Latency"
                      htmlName="lbPassiveHealthUnhealthyLatency"
                      placeholder="5s"
                      value={text.passiveHealthUnhealthyLatency}
                      onChange={setTextField("passiveHealthUnhealthyLatency")}
                      description="Latency threshold for unhealthy"
                    />
                  </Grid>
                )}
              </VStack>
            </Card>
          </VStack>
        )}
      </VStack>
    </Card>
  );
}
