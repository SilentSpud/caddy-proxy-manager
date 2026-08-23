"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { IconButton } from "@astryxdesign/core/IconButton";
import { NumberInput } from "@astryxdesign/core/NumberInput";
import { Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { HStack, VStack } from "@astryxdesign/core/Stack";

type Props = {
  value?: number[];
};

export function WafRuleExclusions({ value }: Props) {
  const [ids, setIds] = useState<number[]>(value ?? []);
  const [draft, setDraft] = useState<number | null>(null);

  function addId() {
    if (draft === null || !Number.isInteger(draft) || draft <= 0) return;
    setIds((prev) => (prev.includes(draft) ? prev : [...prev, draft]));
    setDraft(null);
  }

  return (
    <VStack gap={2}>
      <input type="hidden" name="wafExcludedRuleIds" value={JSON.stringify(ids)} />

      <VStack gap={1}>
        <Text type="body" size="sm" weight="semibold">
          Excluded Rule IDs
        </Text>
        <Text type="body" size="xsm" color="secondary">
          Rules listed here are disabled via SecRuleRemoveById
        </Text>
      </VStack>

      {ids.length > 0 && (
        <HStack gap={2} wrap="wrap">
          {ids.map((id) => (
            // Token owns its own remove control, replacing the button nested
            // inside a Badge with a hand-rolled hover background.
            <Token
              key={id}
              size="sm"
              label={String(id)}
              onRemove={() => setIds((prev) => prev.filter((x) => x !== id))}
            />
          ))}
        </HStack>
      )}

      <HStack gap={2} vAlign="end">
        <NumberInput
          label="Rule ID"
          isLabelHidden
          placeholder="Rule ID"
          value={draft}
          onChange={setDraft}
          isIntegerOnly
          min={1}
          width={160}
          onEnter={addId}
        />
        <IconButton
          variant="ghost"
          size="sm"
          label="Add excluded rule ID"
          icon={<Plus />}
          onClick={addId}
        />
      </HStack>
    </VStack>
  );
}
