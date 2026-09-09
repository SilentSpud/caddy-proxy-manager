import { WafFields } from "@cpm/controller/src/components/proxy-hosts/WafFields";
import { DemoSurface } from "../DemoSurface";

/** Seeded as a host that has been through detect mode and come out with one exclusion. */
export default function WafDemo() {
  return (
    <DemoSurface>
      <WafFields
        value={{
          enabled: true,
          mode: "On",
          load_owasp_crs: true,
          waf_mode: "merge",
          excluded_rule_ids: [942100],
          custom_directives:
            'SecRule REQUEST_URI "@beginsWith /api/" "id:9001,phase:1,ctl:ruleEngine=Off,nolog"\n',
        }}
      />
    </DemoSurface>
  );
}
