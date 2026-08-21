"use client";

import { useState } from "react";
import { Trash2, Plus } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Card } from "@astryxdesign/core/Card";
import { TextInput } from "@astryxdesign/core/TextInput";
import { TextArea } from "@astryxdesign/core/TextArea";
import { Text } from "@astryxdesign/core/Text";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import type { ErrorPageRule } from "@/lib/models/proxy-hosts";

type RuleState = { statuses: string; body: string; contentType: string };

function toState(rules: ErrorPageRule[]): RuleState[] {
  return rules.map((r) => ({
    statuses: r.statuses.join(", "),
    body: r.body,
    contentType: r.contentType ?? "",
  }));
}

function parseStatuses(value: string): number[] {
  return [
    ...new Set(
      value
        .split(",")
        .map((part) => parseInt(part.trim(), 10))
        .filter((n) => Number.isInteger(n) && n >= 400 && n <= 599)
    ),
  ];
}

function toJson(rules: RuleState[]): string {
  return JSON.stringify(
    rules
      .filter((r) => r.body.trim())
      .map((r) => {
        const out: ErrorPageRule = { statuses: parseStatuses(r.statuses), body: r.body };
        if (r.contentType.trim()) out.contentType = r.contentType.trim();
        return out;
      })
  );
}

type Props = {
  initialData?: ErrorPageRule[];
  // The form field name to emit. Lets the same editor back the per-host form and
  // the global settings form.
  name?: string;
};

export function ErrorPagesFields({ initialData = [], name = "errorPagesJson" }: Props) {
  const [rules, setRules] = useState<RuleState[]>(toState(initialData));

  const addRule = () =>
    setRules((r) => [
      ...r,
      {
        statuses: "502, 503, 504",
        body: "<h1>Service temporarily unavailable</h1>",
        contentType: "",
      },
    ]);

  const removeRule = (i: number) => setRules((r) => r.filter((_, idx) => idx !== i));
  const updateRule = (i: number, key: keyof RuleState, value: string) =>
    setRules((r) => r.map((rule, idx) => (idx === i ? { ...rule, [key]: value } : rule)));

  return (
    <VStack gap={2}>
      <Text type="body" size="sm" weight="semibold">
        Error Pages
      </Text>
      <input type="hidden" name={name} value={toJson(rules)} />

      {rules.length > 0 && (
        <VStack gap={3}>
          {rules.map((rule, i) => (
            <Card key={i}>
              <VStack gap={2}>
                <HStack gap={2} vAlign="end">
                  <TextInput
                    label="Status codes"
                    size="sm"
                    placeholder="502, 503, 504 (blank = all errors)"
                    value={rule.statuses}
                    onChange={(next) => updateRule(i, "statuses", next)}
                  />
                  <TextInput
                    label="Content type"
                    isOptional
                    size="sm"
                    placeholder="text/html; charset=utf-8"
                    value={rule.contentType}
                    onChange={(next) => updateRule(i, "contentType", next)}
                  />
                  <IconButton
                    variant="ghost"
                    size="sm"
                    label={`Remove error page ${i + 1}`}
                    icon={<Trash2 />}
                    onClick={() => removeRule(i)}
                  />
                </HStack>
                <TextArea
                  label="Response body"
                  isLabelHidden
                  placeholder="<h1>Service temporarily unavailable</h1>"
                  value={rule.body}
                  onChange={(next) => updateRule(i, "body", next)}
                  rows={3}
                />
              </VStack>
            </Card>
          ))}
        </VStack>
      )}

      <HStack>
        <Button variant="ghost" size="sm" label="Add Error Page" icon={<Plus />} onClick={addRule} />
      </HStack>

      <Text type="body" size="xsm" color="secondary">
        Serve a custom response body when a request errors (e.g. 502/503 when the upstream is down,
        or 404). Comma-separate status codes, or leave blank to match every error. The original
        status code is preserved.
      </Text>
    </VStack>
  );
}
