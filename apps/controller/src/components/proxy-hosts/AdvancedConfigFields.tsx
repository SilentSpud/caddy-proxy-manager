"use client";

/**
 * The three raw-config escape hatches a proxy host offers, shared so create and edit cannot drift.
 * Each label says where in the request path its content lands.
 */

import { useState } from "react";
import { VStack } from "@astryxdesign/core/Stack";
import { CodeEditor } from "@/components/ui/CodeEditor";
import type { ProxyHost } from "@/lib/models/proxy-hosts";
import { useTranslations } from "next-intl";

const CADDYFILE_PLACEHOLDER = `# Directives run before this host's reverse proxy.
# Example: serve a maintenance page for one path.
handle /status* {
  respond "ok" 200
}`;

export function AdvancedConfigFields({
  host,
}: {
  /** The host being edited, or the one being duplicated. Null for a blank create. */
  host?: Pick<
    ProxyHost,
    "customPreHandlersJson" | "customReverseProxyJson" | "customCaddyfile"
  > | null;
}) {
  const t = useTranslations("proxyHosts");
  const [preHandlers, setPreHandlers] = useState(host?.customPreHandlersJson ?? "");
  const [reverseProxy, setReverseProxy] = useState(host?.customReverseProxyJson ?? "");
  const [caddyfile, setCaddyfile] = useState(host?.customCaddyfile ?? "");

  return (
    <VStack gap={5}>
      <CodeEditor
        label={t("customCaddyfile")}
        htmlName="customCaddyfile"
        language="caddyfile"
        value={caddyfile}
        onChange={setCaddyfile}
        placeholder={CADDYFILE_PLACEHOLDER}
        height="md"
        description={t("customCaddyfileHelp")}
      />
      <CodeEditor
        label={t("customPreHandlersJson")}
        htmlName="customPreHandlersJson"
        language="json"
        value={preHandlers}
        onChange={setPreHandlers}
        placeholder='[{"handler": "headers", "response": {"set": {"X-Example": ["1"]}}}]'
        height="sm"
        description={t("customPreHandlersHelp")}
      />
      <CodeEditor
        label={t("customReverseProxyJson")}
        htmlName="customReverseProxyJson"
        language="json"
        value={reverseProxy}
        onChange={setReverseProxy}
        placeholder='{"headers": {"request": {"set": {"X-Example": ["1"]}}}}'
        height="sm"
        description={t("customReverseProxyHelp")}
      />
    </VStack>
  );
}
