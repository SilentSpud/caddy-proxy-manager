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
import { withRowId, withRowIds, type WithRowId } from "@/lib/row-id";
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

// Both levels carry a row id: a rule and any one of its upstreams can be removed
// on its own, so each needs an identity React can reconcile on.
type RuleState = {
  path: string;
  upstreams: WithRowId<UpstreamEntry>[];
  loadBalancer: LoadBalancerConfig | null;
};

function blankUpstream(): WithRowId<UpstreamEntry> {
  return withRowId({ protocol: "http://", address: "" });
}

function toState(rules: LocationRule[]): WithRowId<RuleState>[] {
  return withRowIds(
    rules.map((r) => ({
      path: r.path,
      upstreams:
        r.upstreams.length > 0 ? withRowIds(r.upstreams.map(parseUpstream)) : [blankUpstream()],
      loadBalancer: r.loadBalancer ?? null,
    })),
  );
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
      .filter((r) => r.upstreams.length > 0),
  );
}

type Props = { initialData?: LocationRule[] };

export function LocationRulesFields({ initialData = [] }: Props) {
  const [rules, setRules] = useState<WithRowId<RuleState>[]>(() => toState(initialData));

  // Applies a change to the one rule with this id, leaving the others by reference.
  const patchRule = (ruleId: string, patch: (rule: WithRowId<RuleState>) => RuleState) =>
    setRules((r) =>
      r.map((rule) => (rule.rowId === ruleId ? { ...patch(rule), rowId: rule.rowId } : rule)),
    );

  const addRule = () =>
    setRules((r) => [
      ...r,
      withRowId({ path: "", upstreams: [blankUpstream()], loadBalancer: null }),
    ]);

  const removeRule = (ruleId: string) => setRules((r) => r.filter((rule) => rule.rowId !== ruleId));

  const updatePath = (ruleId: string, value: string) =>
    patchRule(ruleId, (rule) => ({ ...rule, path: value }));

  const updateLoadBalancer = (ruleId: string, value: LoadBalancerConfig | null) =>
    patchRule(ruleId, (rule) => ({ ...rule, loadBalancer: value }));

  const addUpstream = (ruleId: string) =>
    patchRule(ruleId, (rule) => ({ ...rule, upstreams: [...rule.upstreams, blankUpstream()] }));

  const removeUpstream = (ruleId: string, upId: string) =>
    patchRule(ruleId, (rule) =>
      rule.upstreams.length > 1
        ? { ...rule, upstreams: rule.upstreams.filter((u) => u.rowId !== upId) }
        : rule,
    );

  const updateUpstreamProtocol = (ruleId: string, upId: string, protocol: string) =>
    patchRule(ruleId, (rule) => ({
      ...rule,
      upstreams: rule.upstreams.map((u) => (u.rowId === upId ? { ...u, protocol } : u)),
    }));

  const updateUpstreamAddress = (ruleId: string, upId: string, address: string) =>
    patchRule(ruleId, (rule) => ({
      ...rule,
      upstreams: rule.upstreams.map((u) => {
        if (u.rowId !== upId) return u;
        if (address.startsWith("https://"))
          return { ...u, protocol: "https://", address: address.slice(8) };
        if (address.startsWith("http://"))
          return { ...u, protocol: "http://", address: address.slice(7) };
        return { ...u, address };
      }),
    }));

  return (
    <VStack gap={2}>
      <Text type="body" size="sm" weight="semibold">
        Location Rules
      </Text>
      <input type="hidden" name="locationRulesJson" value={toJson(rules)} />

      {rules.length > 0 && (
        <VStack gap={4}>
          {rules.map((rule, i) => (
            <Card key={rule.rowId}>
              <VStack gap={3}>
                <HStack gap={2} vAlign="end">
                  <TextInput
                    label="Path Pattern"
                    size="sm"
                    placeholder="/ws/*"
                    value={rule.path}
                    onChange={(next) => updatePath(rule.rowId, next)}
                  />
                  <IconButton
                    variant="ghost"
                    size="sm"
                    label={`Remove location rule ${i + 1}`}
                    icon={<Trash2 />}
                    onClick={() => removeRule(rule.rowId)}
                  />
                </HStack>

                <VStack gap={2}>
                  <Text type="body" size="xsm" color="secondary" weight="medium">
                    Upstreams
                  </Text>
                  {rule.upstreams.map((up, j) => {
                    const isOnlyUpstream = rule.upstreams.length === 1;
                    return (
                      <HStack key={up.rowId} gap={2} vAlign="end">
                        <Selector
                          label="Protocol"
                          isLabelHidden
                          size="sm"
                          width={120}
                          options={PROTOCOL_OPTIONS}
                          value={up.protocol}
                          onChange={(next) =>
                            updateUpstreamProtocol(rule.rowId, up.rowId, next as string)
                          }
                        />
                        <TextInput
                          label={`Upstream ${j + 1}`}
                          isLabelHidden
                          size="sm"
                          value={up.address}
                          onChange={(next) => updateUpstreamAddress(rule.rowId, up.rowId, next)}
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
                          onClick={() => removeUpstream(rule.rowId, up.rowId)}
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
                      onClick={() => addUpstream(rule.rowId)}
                    />
                  </HStack>
                </VStack>

                <LocationLoadBalancerFields
                  value={rule.loadBalancer}
                  onChange={(value) => updateLoadBalancer(rule.rowId, value)}
                />
              </VStack>
            </Card>
          ))}
        </VStack>
      )}

      <HStack>
        <Button
          variant="ghost"
          size="sm"
          label="Add Location Rule"
          icon={<Plus />}
          onClick={addRule}
        />
      </HStack>
    </VStack>
  );
}
