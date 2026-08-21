"use client";

import { useState } from "react";
import { Trash2, Plus } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { IconButton } from "@astryxdesign/core/IconButton";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Text } from "@astryxdesign/core/Text";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import type { PathAllowRule } from "@/lib/models/proxy-hosts";

type Props = { initialData?: PathAllowRule[] };

export function PathAllowsFields({ initialData = [] }: Props) {
  const [rules, setRules] = useState<PathAllowRule[]>(initialData);

  const addRule = () => setRules((r) => [...r, { path: "" }]);
  const removeRule = (i: number) => setRules((r) => r.filter((_, idx) => idx !== i));
  const updateRule = (i: number, value: string) =>
    setRules((r) => r.map((rule, idx) => (idx === i ? { path: value } : rule)));

  return (
    <VStack gap={2}>
      <Text type="body" size="sm" weight="semibold">
        Path Allows
      </Text>
      <input
        type="hidden"
        name="pathAllowsJson"
        value={JSON.stringify(rules.filter((r) => r.path.trim()))}
      />

      {rules.length > 0 && (
        <VStack gap={2}>
          {rules.map((rule, i) => (
            <HStack key={i} gap={2} vAlign="end">
              <TextInput
                label={`Path ${i + 1}`}
                isLabelHidden={i > 0}
                size="sm"
                placeholder="/secret"
                value={rule.path}
                onChange={(next) => updateRule(i, next)}
              />
              <IconButton
                variant="ghost"
                size="sm"
                label={`Remove path allow ${i + 1}`}
                icon={<Trash2 />}
                onClick={() => removeRule(i)}
              />
            </HStack>
          ))}
        </VStack>
      )}

      <HStack>
        <Button variant="ghost" size="sm" label="Add Path Allow" icon={<Plus />} onClick={addRule} />
      </HStack>

      <Text type="body" size="xsm" color="secondary">
        Paths that bypass any matching Path Block and reach the upstream. Allows are folded into
        every block&apos;s matcher: a block fires only for requests that match its pattern and do
        not match any allow. Example: allow /secret + block /* means only /secret reaches the
        upstream; everything else returns the block status. Allows do not affect Path Rewrites.
      </Text>
    </VStack>
  );
}
