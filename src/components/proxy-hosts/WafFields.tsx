"use client";

import { useState } from "react";
import { ClipboardCopy, ShieldOff } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { Divider } from "@astryxdesign/core/Divider";
import { Icon } from "@astryxdesign/core/Icon";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import type { WafHostConfig } from "@/lib/models/proxy-hosts";
import { WafRuleExclusions } from "./WafRuleExclusions";
import { ModuleGated, useDisabledReason } from "@/components/caddy-modules/ModuleGate";
import { CodeEditor } from "@/components/ui/CodeEditor";

type WafMode = "merge" | "override";
type EngineMode = "Off" | "On" | "inherit";

const QUICK_TEMPLATES = [
  {
    label: "Allow IP",
    snippet: `SecRule REMOTE_ADDR "@ipMatch 1.2.3.4" "id:9000,phase:1,allow,nolog,msg:'Allow IP'"`,
  },
  {
    label: "Disable WAF for path",
    snippet: `SecRule REQUEST_URI "@beginsWith /api/" "id:9001,phase:1,ctl:ruleEngine=Off,nolog"`,
  },
  { label: "Remove XSS rules", snippet: `SecRuleRemoveByTag "attack-xss"` },
  {
    label: "Block User-Agent",
    snippet: `SecRule REQUEST_HEADERS:User-Agent "@contains badbot" "id:9002,phase:1,deny,status:403,log"`,
  },
];

type Props = {
  value?: WafHostConfig | null;
  showModeSelector?: boolean;
};

export function WafFields({ value, showModeSelector = true }: Props) {
  // The WAF is the Coraza plugin and nothing else. Without it compiled in, a
  // saved rule set is inert, so the switch reports why instead of accepting
  // configuration that will never run.
  const moduleDisabledReason = useDisabledReason("waf");
  const [enabled, setEnabled] = useState(value?.enabled ?? false);
  const [wafMode, setWafMode] = useState<WafMode>(value?.waf_mode ?? "merge");
  const [engineMode, setEngineMode] = useState<EngineMode>(
    value?.mode === "Off" || value?.mode === "On" ? value.mode : "inherit",
  );
  const [loadCrs, setLoadCrs] = useState(value?.load_owasp_crs ?? true);
  const [customDirectives, setCustomDirectives] = useState(value?.custom_directives ?? "");

  return (
    <Card>
      <input type="hidden" name="wafPresent" value="1" />
      <input type="hidden" name="wafEnabled" value={enabled ? "on" : ""} />
      <input type="hidden" name="wafMode" value={wafMode} />
      <input type="hidden" name="wafEngineMode" value={engineMode} />
      <input type="hidden" name="wafLoadOwaspCrs" value={loadCrs ? "on" : ""} />
      <input type="hidden" name="wafCustomDirectives" value={customDirectives} />

      <VStack gap={4}>
        <HStack justify="between" vAlign="start" gap={2}>
          <HStack gap={3} vAlign="start">
            <Icon icon={ShieldOff} size="md" color="error" />
            <VStack gap={1}>
              <Text type="body" size="sm" weight="bold">
                Web Application Firewall
              </Text>
              <Text type="body" size="sm" color="secondary">
                Inspect and block malicious requests via Coraza / OWASP CRS
              </Text>
            </VStack>
          </HStack>
          {/* Disabled controls emit no pointer events, so the explanation is
              attached by wrapping rather than as a prop on the Switch. */}
          <ModuleGated feature="waf">
            <Switch
              label="Enable web application firewall"
              isLabelHidden
              value={enabled}
              onChange={setEnabled}
              isDisabled={Boolean(moduleDisabledReason)}
            />
          </ModuleGated>
        </HStack>

        {moduleDisabledReason && (
          <Text type="body" size="xsm" color="secondary">
            {moduleDisabledReason}
          </Text>
        )}

        {/* Unmounted when off, so the fields below are neither focusable nor
            submitted — the old max-h-0 wrapper left them in the tab order. */}
        {/* Not gated on moduleDisabledReason: WafRuleExclusions carries the
            hidden wafExcludedRuleIds input, and parseWafConfig reads a missing
            one as "no exclusions". Unmounting it here would wipe the operator's
            suppression list on the next save. */}
        {enabled && (
          <VStack gap={4}>
            {showModeSelector && (
              <>
                {/* Real radio-group semantics, replacing clickable divs. */}
                <SegmentedControl
                  label="Global rule handling"
                  value={wafMode}
                  onChange={(next) => setWafMode(next as WafMode)}
                >
                  <SegmentedControlItem value="merge" label="Merge with global" />
                  <SegmentedControlItem value="override" label="Override global" />
                </SegmentedControl>
                <Divider />
              </>
            )}
            {!showModeSelector && <Divider />}

            <SegmentedControl
              label="Engine Mode"
              value={engineMode}
              onChange={(next) => setEngineMode(next as EngineMode)}
            >
              <SegmentedControlItem value="inherit" label="Global default" />
              <SegmentedControlItem value="Off" label="Off" />
              <SegmentedControlItem value="On" label="On" />
            </SegmentedControl>

            <Divider />

            <CheckboxInput
              label="Load OWASP Core Rule Set"
              description="Covers SQLi, XSS, LFI, RCE and hundreds of other attack patterns"
              value={loadCrs}
              onChange={setLoadCrs}
            />

            <WafRuleExclusions value={value?.excluded_rule_ids} />

            <CodeEditor
              label="Custom SecLang Directives"
              language="ini"
              placeholder={`SecRule REQUEST_URI "@contains /secret" "id:9001,deny,status:403,log,msg:'Blocked path'"`}
              value={customDirectives}
              onChange={setCustomDirectives}
              height="sm"
              description="ModSecurity SecLang syntax. Appended after OWASP CRS if enabled."
            />

            <Collapsible trigger="Quick Templates">
              <VStack gap={2} hAlign="start">
                {QUICK_TEMPLATES.map((t) => (
                  <Button
                    key={t.label}
                    size="sm"
                    variant="secondary"
                    label={t.label}
                    icon={<ClipboardCopy />}
                    onClick={() =>
                      setCustomDirectives((prev) => (prev ? `${prev}\n${t.snippet}` : t.snippet))
                    }
                  />
                ))}
              </VStack>
            </Collapsible>
          </VStack>
        )}
      </VStack>
    </Card>
  );
}
