"use client";

import { Badge } from "@astryxdesign/core/Badge";
import { HStack } from "@astryxdesign/core/Stack";
import { useTranslations } from "next-intl";

/**
 * Environment variables as purple badges beside the name of what they configure.
 *
 * Named rather than explained: an operator holding a `.env` line recognises `CLICKHOUSE_URL`
 * faster than any sentence about it, and the same string is what the settings search matches on.
 */
export function EnvTokens({ names }: { names?: readonly string[] }) {
  const t = useTranslations("settings");
  if (!names || names.length === 0) return null;
  return (
    // A bare div with an aria-label is not exposed; the role is what gives the badges a name
    // instead of reading them out as loose words after the heading.
    <HStack
      gap={1}
      vAlign="center"
      wrap="wrap"
      role="group"
      aria-label={t("environmentVariablesLabel")}
    >
      {names.map((name) => (
        <Badge key={name} label={name} variant="purple" />
      ))}
    </HStack>
  );
}
