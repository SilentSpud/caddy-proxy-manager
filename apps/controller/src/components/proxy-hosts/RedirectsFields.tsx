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
import { withRowId, withRowIds, type WithRowId } from "@/lib/row-id";
import { useTranslations } from "next-intl";

type Props = { initialData?: RedirectRule[] };

const STATUS_OPTIONS = [301, 302, 307, 308].map((s) => ({ value: String(s), label: String(s) }));

export function RedirectsFields({ initialData = [] }: Props) {
  const t = useTranslations("proxyHosts");
  const [rules, setRules] = useState<WithRowId<RedirectRule>[]>(() => withRowIds(initialData));

  const addRule = () => setRules((r) => [...r, withRowId({ from: "", to: "", status: 301 })]);
  const removeRule = (rowId: string) => setRules((r) => r.filter((rule) => rule.rowId !== rowId));
  const updateRule = (rowId: string, key: keyof RedirectRule, value: string | number) =>
    setRules((r) => r.map((rule) => (rule.rowId === rowId ? { ...rule, [key]: value } : rule)));

  return (
    <VStack gap={2}>
      <Text type="body" size="sm" weight="semibold">
        {t("redirects")}{" "}
      </Text>
      <input
        type="hidden"
        name="redirectsJson"
        value={JSON.stringify(
          rules.map(({ from, to, status }): RedirectRule => ({ from, to, status })),
        )}
      />

      {rules.length > 0 && (
        <VStack gap={2}>
          {rules.map((rule, i) => (
            <HStack key={rule.rowId} gap={2} vAlign="end">
              <TextInput
                label={t("fromPath")}
                isLabelHidden={i > 0}
                size="sm"
                placeholder="/.well-known/carddav"
                value={rule.from}
                onChange={(next) => updateRule(rule.rowId, "from", next)}
              />
              <TextInput
                label={t("toUrlPath")}
                isLabelHidden={i > 0}
                size="sm"
                placeholder="/remote.php/dav/"
                value={rule.to}
                onChange={(next) => updateRule(rule.rowId, "to", next)}
              />
              <Selector
                label={t("status")}
                isLabelHidden={i > 0}
                size="sm"
                width={110}
                options={STATUS_OPTIONS}
                value={String(rule.status)}
                onChange={(next) => updateRule(rule.rowId, "status", Number(next))}
              />
              <IconButton
                variant="ghost"
                size="sm"
                label={`Remove redirect ${i + 1}`}
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
          label={t("addRedirect")}
          icon={<Plus />}
          onClick={addRule}
        />
      </HStack>
    </VStack>
  );
}
