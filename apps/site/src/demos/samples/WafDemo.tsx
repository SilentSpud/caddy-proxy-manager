import { WafFields } from "@cpm/controller/src/components/proxy-hosts/WafFields";
import { WafPresetOptionsProvider } from "@cpm/controller/src/components/proxy-hosts/WafPresetOptions";
import { DemoSurface } from "../DemoSurface";

const PRESETS = [
  { id: 1, name: "Nextcloud", description: "WebDAV and editor exclusions" },
  { id: 2, name: "WordPress", description: "Admin and REST API exclusions" },
  { id: 3, name: "Immich", description: "Upload exclusions" },
];

/** Seeded as a host that has been through detect mode and come out with one exclusion and a preset. */
export default function WafDemo() {
  return (
    <DemoSurface>
      <WafPresetOptionsProvider presets={PRESETS}>
        <WafFields
          value={{
            enabled: true,
            mode: "On",
            load_owasp_crs: true,
            waf_mode: "merge",
            excluded_rule_ids: [942100],
            preset_ids: [1],
            custom_directives:
              'SecRule REQUEST_URI "@beginsWith /api/" "id:9001,phase:1,pass,nolog,ctl:ruleRemoveById=942100"\n',
          }}
        />
      </WafPresetOptionsProvider>
    </DemoSurface>
  );
}
