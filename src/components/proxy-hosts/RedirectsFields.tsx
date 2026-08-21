"use client";

import { useState } from "react";
import { Trash2, Plus } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { IconButton } from "@astryxdesign/core/IconButton";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import type { RedirectRule } from "@/lib/models/proxy-hosts";

type Props = { initialData?: RedirectRule[] };

const STATUS_OPTIONS = [301, 302, 307, 308].map((s) => ({ value: String(s), label: String(s) }));

export function RedirectsFields({ initialData = [] }: Props) {
  const [rules, setRules] = useState<RedirectRule[]>(initialData);

  const addRule = () => setRules((r) => [...r, { from: "", to: "", status: 301 }]);
  const removeRule = (i: number) => setRules((r) => r.filter((_, idx) => idx !== i));
  const updateRule = (i: number, key: keyof RedirectRule, value: string | number) =>
    setRules((r) => r.map((rule, idx) => (idx === i ? { ...rule, [key]: value } : rule)));

  return (
    <VStack gap={2}>
      <Text type="body" size="sm" weight="semibold">
        Redirects
      </Text>
      <input type="hidden" name="redirectsJson" value={JSON.stringify(rules)} />

      {rules.length > 0 && (
        <VStack gap={2}>
          {rules.map((rule, i) => (
            <HStack key={i} gap={2} vAlign="end">
              <TextInput
                label="From Path"
                isLabelHidden={i > 0}
                size="sm"
                placeholder="/.well-known/carddav"
                value={rule.from}
                onChange={(next) => updateRule(i, "from", next)}
              />
              <TextInput
                label="To URL / Path"
                isLabelHidden={i > 0}
                size="sm"
                placeholder="/remote.php/dav/"
                value={rule.to}
                onChange={(next) => updateRule(i, "to", next)}
              />
              <Selector
                label="Status"
                isLabelHidden={i > 0}
                size="sm"
                width={110}
                options={STATUS_OPTIONS}
                value={String(rule.status)}
                onChange={(next) => updateRule(i, "status", Number(next))}
              />
              <IconButton
                variant="ghost"
                size="sm"
                label={`Remove redirect ${i + 1}`}
                icon={<Trash2 />}
                onClick={() => removeRule(i)}
              />
            </HStack>
          ))}
        </VStack>
      )}

      <HStack>
        <Button variant="ghost" size="sm" label="Add Redirect" icon={<Plus />} onClick={addRule} />
      </HStack>
    </VStack>
  );
}
