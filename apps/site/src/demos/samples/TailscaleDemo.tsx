import { TailscaleFields } from "@cpm/controller/src/components/proxy-hosts/TailscaleFields";
import { DemoSurface } from "../DemoSurface";

/** Served on the tailnet and nowhere else, which is the reason most people turn this on. */
export default function TailscaleDemo() {
  return (
    <DemoSurface>
      <TailscaleFields
        defaults={{ enabled: true, hasAuthKey: true, defaultNode: "caddy" }}
        tailscale={{
          serve: true,
          node: "",
          tailnetOnly: true,
          auth: true,
          protected_paths: null,
          excluded_paths: null,
          forwardIdentity: true,
          upstreamNode: null,
        }}
      />
    </DemoSurface>
  );
}
