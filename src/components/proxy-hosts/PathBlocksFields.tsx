"use client";

import { useState } from "react";
import { Trash2, Plus } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { IconButton } from "@astryxdesign/core/IconButton";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import type { PathBlockRule, PathBlockStatusCode } from "@/lib/models/proxy-hosts";
import { withRowId, withRowIds, type WithRowId } from "@/lib/row-id";

// Mirrors PATH_BLOCK_STATUS_CODES in src/lib/models/proxy-hosts.ts. Kept inline so this
// client component does not pull the server-only model module into the bundle.
const STATUS_CODES: readonly PathBlockStatusCode[] = [
  400, 401, 403, 404, 410, 418, 451, 500, 502, 503,
];
const STATUS_OPTIONS = STATUS_CODES.map((s) => ({ value: String(s), label: String(s) }));

type RuleState = { path: string; status: PathBlockStatusCode; body: string };

function toState(rules: PathBlockRule[]): WithRowId<RuleState>[] {
  return withRowIds(rules.map((r) => ({ path: r.path, status: r.status, body: r.body ?? "" })));
}

function toJson(rules: RuleState[]): string {
  return JSON.stringify(
    rules
      .filter((r) => r.path.trim())
      .map((r) => {
        const out: PathBlockRule = { path: r.path.trim(), status: r.status };
        if (r.body.trim()) out.body = r.body;
        return out;
      }),
  );
}

type Props = { initialData?: PathBlockRule[] };

export function PathBlocksFields({ initialData = [] }: Props) {
  const [rules, setRules] = useState<WithRowId<RuleState>[]>(() => toState(initialData));

  const addRule = () =>
    setRules((r) => [
      ...r,
      withRowId({ path: "", status: 403 as PathBlockStatusCode, body: "Forbidden" }),
    ]);
  const removeRule = (rowId: string) => setRules((r) => r.filter((rule) => rule.rowId !== rowId));
  const updateRule = (rowId: string, key: keyof RuleState, value: string | number) =>
    setRules((r) => r.map((rule) => (rule.rowId === rowId ? { ...rule, [key]: value } : rule)));

  return (
    <VStack gap={2}>
      <Text type="body" size="sm" weight="semibold">
        Path Blocks
      </Text>
      <input type="hidden" name="pathBlocksJson" value={toJson(rules)} />

      {rules.length > 0 && (
        <VStack gap={2}>
          {rules.map((rule, i) => (
            <HStack key={rule.rowId} gap={2} vAlign="end">
              <TextInput
                label="Path"
                isLabelHidden={i > 0}
                size="sm"
                placeholder="/dns-query"
                value={rule.path}
                onChange={(next) => updateRule(rule.rowId, "path", next)}
              />
              <Selector
                label="Status"
                isLabelHidden={i > 0}
                size="sm"
                width={120}
                options={STATUS_OPTIONS}
                value={String(rule.status)}
                onChange={(next) => updateRule(rule.rowId, "status", Number(next))}
              />
              <TextInput
                label="Body"
                isOptional
                isLabelHidden={i > 0}
                size="sm"
                placeholder="Forbidden"
                value={rule.body}
                onChange={(next) => updateRule(rule.rowId, "body", next)}
              />
              <IconButton
                variant="ghost"
                size="sm"
                label={`Remove path block ${i + 1}`}
                icon={<Trash2 />}
                onClick={() => removeRule(rule.rowId)}
              />
            </HStack>
          ))}
        </VStack>
      )}

      <HStack>
        <Button
          variant="ghost"
          size="sm"
          label="Add Path Block"
          icon={<Plus />}
          onClick={addRule}
        />
      </HStack>

      <Text type="body" size="xsm" color="secondary">
        Return a static response (no proxying) for matching paths. Supports Caddy path patterns like
        /dns-query or /admin/*.
      </Text>
    </VStack>
  );
}
