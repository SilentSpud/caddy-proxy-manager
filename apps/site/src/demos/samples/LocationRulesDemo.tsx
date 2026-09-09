import { LocationRulesFields } from "@cpm/controller/src/components/proxy-hosts/LocationRulesFields";
import { DemoSurface } from "../DemoSurface";

/** The example from the prose above: an API and a websocket endpoint on separate backends. */
export default function LocationRulesDemo() {
  return (
    <DemoSurface>
      <LocationRulesFields
        initialData={[
          { path: "/api/*", upstreams: ["http://api:3000"], loadBalancer: null },
          { path: "/ws/*", upstreams: ["http://realtime:8000"], loadBalancer: null },
        ]}
      />
    </DemoSurface>
  );
}
