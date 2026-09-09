import { CaddyBuildFields } from "@cpm/controller/src/components/caddy-modules/CaddyBuildFields";
import { DemoSurface } from "../DemoSurface";

/**
 * The real module picker. It polls `/api/caddy-build` for what is currently built, which on a
 * static site answers nothing - so the status line stays blank and Rebuild reports that it could
 * not start. The selection itself is the part worth showing, and that works.
 */
export default function CaddyBuildDemo() {
  return (
    <DemoSurface>
      <CaddyBuildFields
        initialModules={{ "github.com/mholt/caddy-l4": false }}
        initialCustomModules={[]}
      />
    </DemoSurface>
  );
}
