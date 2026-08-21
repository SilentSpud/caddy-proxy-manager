"use client";

import { useState } from "react";
import { Trash2, Plus, MinusCircle } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Card } from "@astryxdesign/core/Card";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import type { LocationRule, LoadBalancerConfig } from "@/lib/models/proxy-hosts";
import { LocationLoadBalancerFields } from "./LocationLoadBalancerFields";

type UpstreamEntry = { protocol: string; address: string };

const PROTOCOL_OPTIONS = [
  { value: "http://", label: "http://" },
  { value: "https://", label: "https://" },
];

function parseUpstream(upstream: string): UpstreamEntry {
  if (upstream.startsWith("https://")) return { protocol: "https://", address: upstream.slice(8) };
  if (upstream.startsWith("http://")) return { protocol: "http://", address: upstream.slice(7) };
  return { protocol: "http://", address: upstream };
}

function serializeUpstream(entry: UpstreamEntry): string {
  return `${entry.protocol}${entry.address.trim()}`;
}

type RuleState = { path: string; upstreams: UpstreamEntry[]; loadBalancer: LoadBalancerConfig | null };

function toState(rules: LocationRule[]): RuleState[] {
  return rules.map((r) => ({
    path: r.path,
    upstreams:
      r.upstreams.length > 0
        ? r.upstreams.map(parseUpstream)
        : [{ protocol: "http://", address: "" }],
    loadBalancer: r.loadBalancer ?? null,
  }));
}

function toJson(rules: RuleState[]): string {
  return JSON.stringify(
    rules
      .filter((r) => r.path.trim())
      .map((r) => ({
        path: r.path.trim(),
        upstreams: r.upstreams.filter((u) => u.address.trim()).map(serializeUpstream),
        loadBalancer: r.loadBalancer?.enabled ? r.loadBalancer : null,
      }))
      .filter((r) => r.upstreams.length > 0)
  );
}

type Props = { initialData?: LocationRule[] };

export function LocationRulesFields({ initialData = [] }: Props) {
  const [rules, setRules] = useState<RuleState[]>(toState(initialData));

  const addRule = () =>
    setRules((r) => [
      ...r,
      { path: "", upstreams: [{ protocol: "http://", address: "" }], loadBalancer: null },
    ]);

  const removeRule = (i: number) => setRules((r) => r.filter((_, idx) => idx !== i));

  const updatePath = (i: number, value: string) =>
    setRules((r) => r.map((rule, idx) => (idx === i ? { ...rule, path: value } : rule)));

  const updateLoadBalancer = (i: number, value: LoadBalancerConfig | null) =>
    setRules((r) => r.map((rule, idx) => (idx === i ? { ...rule, loadBalancer: value } : rule)));

  const addUpstream = (ruleIdx: number) =>
    setRules((r) =>
      r.map((rule, idx) =>
        idx === ruleIdx
          ? { ...rule, upstreams: [...rule.upstreams, { protocol: "http://", address: "" }] }
          : rule
      )
    );

  const removeUpstream = (ruleIdx: number, upIdx: number) =>
    setRules((r) =>
      r.map((rule, idx) =>
        idx === ruleIdx && rule.upstreams.length > 1
          ? { ...rule, upstreams: rule.upstreams.filter((_, i) => i !== upIdx) }
          : rule
      )
    );

  const updateUpstreamProtocol = (ruleIdx: number, upIdx: number, protocol: string) =>
    setRules((r) =>
      r.map((rule, idx) =>
        idx === ruleIdx
          ? {
              ...rule,
              upstreams: rule.upstreams.map((u, i) => (i === upIdx ? { ...u, protocol } : u)),
            }
          : rule
      )
    );

  const updateUpstreamAddress = (ruleIdx: number, upIdx: number, address: string) =>
    setRules((r) =>
      r.map((rule, idx) => {
        if (idx !== ruleIdx) return rule;
        return {
          ...rule,
          upstreams: rule.upstreams.map((u, i) => {
            if (i !== upIdx) return u;
            if (address.startsWith("https://")) return { protocol: "https://", address: address.slice(8) };
            if (address.startsWith("http://")) return { protocol: "http://", address: address.slice(7) };
            return { ...u, address };
          }),
        };
      })
    );

  return (
    <VStack gap={2}>
      <Text type="body" size="sm" weight="semibold">
        Location Rules
      </Text>
      <input type="hidden" name="locationRulesJson" value={toJson(rules)} />

      {rules.length > 0 && (
        <VStack gap={4}>
          {rules.map((rule, i) => (
            <Card key={i}>
              <VStack gap={3}>
                <HStack gap={2} vAlign="end">
                  <TextInput
                    label="Path Pattern"
                    size="sm"
                    placeholder="/ws/*"
                    value={rule.path}
                    onChange={(next) => updatePath(i, next)}
                  />
                  <IconButton
                    variant="ghost"
                    size="sm"
                    label={`Remove location rule ${i + 1}`}
                    icon={<Trash2 />}
                    onClick={() => removeRule(i)}
                  />
                </HStack>

                <VStack gap={2}>
                  <Text type="body" size="xsm" color="secondary" weight="medium">
                    Upstreams
                  </Text>
                  {rule.upstreams.map((up, j) => {
                    const isOnlyUpstream = rule.upstreams.length === 1;
                    return (
                      <HStack key={j} gap={2} vAlign="end">
                        <Selector
                          label="Protocol"
                          isLabelHidden
                          size="sm"
                          width={120}
                          options={PROTOCOL_OPTIONS}
                          value={up.protocol}
                          onChange={(next) => updateUpstreamProtocol(i, j, next as string)}
                        />
                        <TextInput
                          label={`Upstream ${j + 1}`}
                          isLabelHidden
                          size="sm"
                          value={up.address}
                          onChange={(next) => updateUpstreamAddress(i, j, next)}
                          placeholder="10.0.0.5:8080"
                        />
                        <IconButton
                          variant="ghost"
                          size="sm"
                          label={`Remove upstream ${j + 1}`}
                          icon={<MinusCircle />}
                          isDisabled={isOnlyUpstream}
                          tooltip={
                            isOnlyUpstream ? "At least one upstream is required" : "Remove upstream"
                          }
                          onClick={() => removeUpstream(i, j)}
                        />
                      </HStack>
                    );
                  })}
                  <HStack>
                    <Button
                      variant="ghost"
                      size="sm"
                      label="Add Upstream"
                      icon={<Plus />}
                      onClick={() => addUpstream(i)}
                    />
                  </HStack>
                </VStack>

                <LocationLoadBalancerFields
                  value={rule.loadBalancer}
                  onChange={(value) => updateLoadBalancer(i, value)}
                />
              </VStack>
            </Card>
          ))}
        </VStack>
      )}

      <HStack>
        <Button variant="ghost" size="sm" label="Add Location Rule" icon={<Plus />} onClick={addRule} />
      </HStack>
    </VStack>
  );
}
