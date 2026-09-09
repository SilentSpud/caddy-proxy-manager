import { PathRewritesFields } from "@cpm/controller/src/components/proxy-hosts/PathRewritesFields";
import { RedirectsFields } from "@cpm/controller/src/components/proxy-hosts/RedirectsFields";
import { VStack } from "@astryxdesign/core/Stack";
import { DemoSurface } from "../DemoSurface";

/** The two are separate controls on the same form, and are easier to tell apart side by side. */
export default function RedirectsDemo() {
  return (
    <DemoSurface>
      <VStack gap={6}>
        <RedirectsFields
          initialData={[{ from: "/.well-known/carddav", to: "/remote.php/dav/", status: 301 }]}
        />
        <PathRewritesFields initialData={[{ from: "/legacy", to: "/v2" }]} />
      </VStack>
    </DemoSurface>
  );
}
