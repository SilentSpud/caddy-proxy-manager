"use client";

import { useState } from "react";
import { Trash2, Plus } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { IconButton } from "@astryxdesign/core/IconButton";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Text } from "@astryxdesign/core/Text";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import type { PathRewriteRule } from "@/lib/models/proxy-hosts";

type Props = { initialData?: PathRewriteRule[] };

export function PathRewritesFields({ initialData = [] }: Props) {
  const [rules, setRules] = useState<PathRewriteRule[]>(initialData);

  const addRule = () => setRules((r) => [...r, { from: "", to: "" }]);
  const removeRule = (i: number) => setRules((r) => r.filter((_, idx) => idx !== i));
  const updateRule = (i: number, key: keyof PathRewriteRule, value: string) =>
    setRules((r) => r.map((rule, idx) => (idx === i ? { ...rule, [key]: value } : rule)));

  return (
    <VStack gap={2}>
      <Text type="body" size="sm" weight="semibold">
        Path Rewrites
      </Text>
      <input type="hidden" name="pathRewritesJson" value={JSON.stringify(rules)} />

      {rules.length > 0 && (
        <VStack gap={2}>
          {rules.map((rule, i) => (
            <HStack key={i} gap={2} vAlign="end">
              <TextInput
                label="From Path"
                isLabelHidden={i > 0}
                size="sm"
                placeholder="/secretpath"
                value={rule.from}
                onChange={(next) => updateRule(i, "from", next)}
              />
              <TextInput
                label="Internal Target URI"
                isLabelHidden={i > 0}
                size="sm"
                placeholder="/dns-query"
                value={rule.to}
                onChange={(next) => updateRule(i, "to", next)}
              />
              <IconButton
                variant="ghost"
                size="sm"
                label={`Remove path rewrite ${i + 1}`}
                icon={<Trash2 />}
                onClick={() => removeRule(i)}
              />
            </HStack>
          ))}
        </VStack>
      )}

      <HStack>
        <Button variant="ghost" size="sm" label="Add Path Rewrite" icon={<Plus />} onClick={addRule} />
      </HStack>

      <Text type="body" size="xsm" color="secondary">
        Internally rewrite the request URI before proxying. The client URL is unchanged; the
        upstream sees the target URI.
      </Text>
    </VStack>
  );
}
