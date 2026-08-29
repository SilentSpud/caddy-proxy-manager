"use client";

/**
 * The three raw-config escape hatches a proxy host offers, shared so create and edit cannot drift.
 * Each label says where in the request path its content lands, not just the format.
 */

import { useState } from "react";
import { VStack } from "@astryxdesign/core/Stack";
import { CodeEditor } from "@/components/ui/CodeEditor";
import type { ProxyHost } from "@/lib/models/proxy-hosts";

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
  const [preHandlers, setPreHandlers] = useState(host?.customPreHandlersJson ?? "");
  const [reverseProxy, setReverseProxy] = useState(host?.customReverseProxyJson ?? "");
  const [caddyfile, setCaddyfile] = useState(host?.customCaddyfile ?? "");

  return (
    <VStack gap={5}>
      <CodeEditor
        label="Custom Caddyfile"
        htmlName="customCaddyfile"
        language="caddyfile"
        value={caddyfile}
        onChange={setCaddyfile}
        placeholder={CADDYFILE_PLACEHOLDER}
        height="md"
        description="Caddyfile directives for this host, adapted by Caddy and inserted before the reverse proxy. Rejected on save if Caddy cannot parse them."
      />
      <CodeEditor
        label="Custom Pre-Handlers (JSON)"
        htmlName="customPreHandlersJson"
        language="json"
        value={preHandlers}
        onChange={setPreHandlers}
        placeholder='[{"handler": "headers", "response": {"set": {"X-Example": ["1"]}}}]'
        height="sm"
        description="JSON array of Caddy handlers, run before the reverse proxy."
      />
      <CodeEditor
        label="Custom Reverse Proxy (JSON)"
        htmlName="customReverseProxyJson"
        language="json"
        value={reverseProxy}
        onChange={setReverseProxy}
        placeholder='{"headers": {"request": {"set": {"X-Example": ["1"]}}}}'
        height="sm"
        description="Deep-merged into the reverse_proxy handler itself (proxy mode only)."
      />
    </VStack>
  );
}
