import { AdvancedConfigFields } from "@cpm/controller/src/components/proxy-hosts/AdvancedConfigFields";
import { DemoSurface } from "../DemoSurface";

/**
 * The three raw-config escape hatches at the bottom of the host editor — the part of the form that
 * has no equivalent anywhere else, and the reason a screenshot of it was never enough.
 */
export default function HostEditorDemo() {
  return (
    <DemoSurface>
      <AdvancedConfigFields
        host={{
          customCaddyfile: `# Served before the reverse proxy, so /status never reaches the upstream.
handle /status* {
  respond "ok" 200
}`,
          customPreHandlersJson: `[{"handler": "headers", "response": {"set": {"X-Frame-Options": ["DENY"]}}}]`,
          customReverseProxyJson: "",
        }}
      />
    </DemoSurface>
  );
}
