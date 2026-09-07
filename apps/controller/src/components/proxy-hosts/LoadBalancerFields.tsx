"use client";

import { useState } from "react";
import { Card } from "@astryxdesign/core/Card";
import { NumberInput } from "@astryxdesign/core/NumberInput";
import { Selector } from "@astryxdesign/core/Selector";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Text } from "@astryxdesign/core/Text";
import { Grid } from "@astryxdesign/core/Grid";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import type { ProxyHost, LoadBalancingPolicy } from "@/lib/models/proxy-hosts";
import { Switch } from "@/src/components/ui/FormBooleanControls";
import { useTranslations } from "next-intl";

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
 * One state object because Astryx inputs are controlled where these were `defaultValue` fields.
 * `htmlName` keeps the submitted FormData keys byte-identical.
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
  const t = useTranslations("proxyHosts");
  const initial = loadBalancer ?? null;
  const [enabled, setEnabled] = useState(initial?.enabled ?? false);
  const [policy, setPolicy] = useState<LoadBalancingPolicy>(initial?.policy ?? "random");
  const [activeHealthEnabled, setActiveHealthEnabled] = useState(
    initial?.activeHealthCheck?.enabled ?? false,
  );
  const [passiveHealthEnabled, setPassiveHealthEnabled] = useState(
    initial?.passiveHealthCheck?.enabled ?? false,
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
    passiveHealthUnhealthyStatus: initial?.passiveHealthCheck?.unhealthyStatus?.join(", ") ?? "",
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
              {t("loadBalancer")}
            </Text>
            <Text type="body" size="sm" color="secondary">
              {t("configureLoadBalancingAnd")}
            </Text>
          </VStack>
          <Switch
            label={t("enableLoadBalancing")}
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
              label={t("selectionPolicy")}
              options={LOAD_BALANCING_POLICIES}
              value={policy}
              onChange={(next) => setPolicy(next as LoadBalancingPolicy)}
            />

            {policy === "header" && (
              <TextInput
                label={t("headerFieldName")}
                htmlName="lbPolicyHeaderField"
                placeholder={t("xCustomHeader")}
                value={text.policyHeaderField}
                onChange={setTextField("policyHeaderField")}
                description={t("theRequestHeaderTo")}
              />
            )}

            {policy === "cookie" && (
              <VStack gap={4}>
                <TextInput
                  label={t("cookieName")}
                  htmlName="lbPolicyCookieName"
                  placeholder="server_id"
                  value={text.policyCookieName}
                  onChange={setTextField("policyCookieName")}
                  description={t("nameOfTheCookie")}
                />
                <TextInput
                  label={t("cookieSecret")}
                  isOptional
                  htmlName="lbPolicyCookieSecret"
                  placeholder="your-secret-key"
                  value={text.policyCookieSecret}
                  onChange={setTextField("policyCookieSecret")}
                  description={t("secretKeyForHmac")}
                />
              </VStack>
            )}

            <VStack gap={2}>
              <Text type="body" size="sm" weight="semibold">
                {t("retrySettings")}
              </Text>
              <Grid columns={3} gap={4}>
                <TextInput
                  label={t("tryDuration")}
                  htmlName="lbTryDuration"
                  placeholder="5s"
                  value={text.tryDuration}
                  onChange={setTextField("tryDuration")}
                  description={t("howLongToTry")}
                />
                <TextInput
                  label={t("tryInterval")}
                  htmlName="lbTryInterval"
                  placeholder="250ms"
                  value={text.tryInterval}
                  onChange={setTextField("tryInterval")}
                  description={t("waitBetweenAttempts")}
                />
                <NumberInput
                  label={t("maxRetries")}
                  htmlName="lbRetries"
                  min={0}
                  isIntegerOnly
                  value={numbers.retries}
                  onChange={setNumberField("retries")}
                  description={t("maximumRetryAttempts")}
                />
              </Grid>
            </VStack>

            <Card variant="muted">
              <input type="hidden" name="lbActiveHealthEnabledPresent" value="1" />
              <VStack gap={4}>
                <Switch
                  label={t("activeHealthChecks")}
                  description={t("periodicallyProbeUpstreamsTo")}
                  htmlName="lbActiveHealthEnabled"
                  value={activeHealthEnabled}
                  onChange={setActiveHealthEnabled}
                />
                {activeHealthEnabled && (
                  <Grid columns={2} gap={4}>
                    <TextInput
                      label={t("healthCheckUri")}
                      htmlName="lbActiveHealthUri"
                      placeholder="/health"
                      value={text.activeHealthUri}
                      onChange={setTextField("activeHealthUri")}
                      description={t("pathToProbeFor")}
                    />
                    <NumberInput
                      label={t("healthCheckPort")}
                      htmlName="lbActiveHealthPort"
                      min={1}
                      max={65535}
                      isIntegerOnly
                      value={numbers.activeHealthPort}
                      onChange={setNumberField("activeHealthPort")}
                      description={t("overrideUpstreamPort")}
                    />
                    <TextInput
                      label={t("checkInterval")}
                      htmlName="lbActiveHealthInterval"
                      placeholder="30s"
                      value={text.activeHealthInterval}
                      onChange={setTextField("activeHealthInterval")}
                      description={t("howOftenToCheck")}
                    />
                    <TextInput
                      label={t("checkTimeout")}
                      htmlName="lbActiveHealthTimeout"
                      placeholder="5s"
                      value={text.activeHealthTimeout}
                      onChange={setTextField("activeHealthTimeout")}
                      description={t("timeoutForHealthProbe")}
                    />
                    <NumberInput
                      label={t("expectedStatusCode")}
                      htmlName="lbActiveHealthStatus"
                      min={100}
                      max={599}
                      isIntegerOnly
                      value={numbers.activeHealthStatus}
                      onChange={setNumberField("activeHealthStatus")}
                      description={t("expectedHttpStatus")}
                    />
                    <TextInput
                      label={t("expectedBody")}
                      htmlName="lbActiveHealthBody"
                      placeholder={t("ok")}
                      value={text.activeHealthBody}
                      onChange={setTextField("activeHealthBody")}
                      description={t("expectedResponseBody")}
                    />
                  </Grid>
                )}
              </VStack>
            </Card>

            <Card variant="muted">
              <input type="hidden" name="lbPassiveHealthEnabledPresent" value="1" />
              <VStack gap={4}>
                <Switch
                  label={t("passiveHealthChecks")}
                  description={t("markUpstreamsUnhealthyBased")}
                  htmlName="lbPassiveHealthEnabled"
                  value={passiveHealthEnabled}
                  onChange={setPassiveHealthEnabled}
                />
                {passiveHealthEnabled && (
                  <Grid columns={2} gap={4}>
                    <TextInput
                      label={t("failDuration")}
                      htmlName="lbPassiveHealthFailDuration"
                      placeholder="30s"
                      value={text.passiveHealthFailDuration}
                      onChange={setTextField("passiveHealthFailDuration")}
                      description={t("howLongToRemember")}
                    />
                    <NumberInput
                      label={t("maxFailures")}
                      htmlName="lbPassiveHealthMaxFails"
                      min={0}
                      isIntegerOnly
                      value={numbers.passiveHealthMaxFails}
                      onChange={setNumberField("passiveHealthMaxFails")}
                      description={t("failuresBeforeMarkingUnhealthy")}
                    />
                    <TextInput
                      label={t("unhealthyStatusCodes")}
                      htmlName="lbPassiveHealthUnhealthyStatus"
                      placeholder="500, 502, 503"
                      value={text.passiveHealthUnhealthyStatus}
                      onChange={setTextField("passiveHealthUnhealthyStatus")}
                      description={t("commaSeparatedStatusCodes")}
                    />
                    <TextInput
                      label={t("unhealthyLatency")}
                      htmlName="lbPassiveHealthUnhealthyLatency"
                      placeholder="5s"
                      value={text.passiveHealthUnhealthyLatency}
                      onChange={setTextField("passiveHealthUnhealthyLatency")}
                      description={t("latencyThresholdForUnhealthy")}
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
