"use client";

import { useState } from "react";
import { ClipboardCopy, ShieldOff } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { Divider } from "@astryxdesign/core/Divider";
import { Icon } from "@astryxdesign/core/Icon";
import { NumberInput } from "@astryxdesign/core/NumberInput";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import type { WafHostConfig } from "@/lib/models/proxy-hosts";
import { bytesToMib, MAX_BODY_LIMIT_MIB, MIN_BODY_LIMIT_MIB } from "@/lib/caddy-waf";
import { WafRuleExclusions } from "./WafRuleExclusions";
import { ModuleGated, useDisabledReason } from "@/components/caddy-modules/ModuleGate";
import { CodeEditor } from "@/components/ui/CodeEditor";
import { useTranslations } from "next-intl";

type WafMode = "merge" | "override";
type EngineMode = "Off" | "On" | "inherit";
type LimitAction = "Reject" | "ProcessPartial" | "inherit";

/** Stored body limits are bytes; the form asks for whole MiB. Null means "inherit". */
function bodyLimitMib(bytes: number | undefined): number | null {
  const mib = bytesToMib(bytes);
  return mib ? Number(mib) : null;
}

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
  const t = useTranslations("proxyHosts");
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
  const [bodyLimitMb, setBodyLimitMb] = useState(bodyLimitMib(value?.request_body_limit));
  const [inMemoryLimitMb, setInMemoryLimitMb] = useState(
    bodyLimitMib(value?.request_body_in_memory_limit),
  );
  const [limitAction, setLimitAction] = useState<LimitAction>(
    value?.request_body_limit_action ?? "inherit",
  );

  return (
    <Card>
      <input type="hidden" name="wafPresent" value="1" />
      <input type="hidden" name="wafEnabled" value={enabled ? "on" : ""} />
      <input type="hidden" name="wafMode" value={wafMode} />
      <input type="hidden" name="wafEngineMode" value={engineMode} />
      <input type="hidden" name="wafLoadOwaspCrs" value={loadCrs ? "on" : ""} />
      <input type="hidden" name="wafCustomDirectives" value={customDirectives} />
      <input type="hidden" name="wafRequestBodyLimitMb" value={bodyLimitMb ?? ""} />
      <input type="hidden" name="wafRequestBodyInMemoryLimitMb" value={inMemoryLimitMb ?? ""} />
      <input
        type="hidden"
        name="wafRequestBodyLimitAction"
        value={limitAction === "inherit" ? "" : limitAction}
      />

      <VStack gap={4}>
        <HStack justify="between" vAlign="start" gap={2}>
          <HStack gap={3} vAlign="start">
            <Icon icon={ShieldOff} size="md" color="error" />
            <VStack gap={1}>
              <Text type="body" size="sm" weight="bold">
                {t("webApplicationFirewall")}
              </Text>
              <Text type="body" size="sm" color="secondary">
                {t("wafDescription")}
              </Text>
            </VStack>
          </HStack>
          {/* Disabled controls emit no pointer events, so the explanation is
              attached by wrapping rather than as a prop on the Switch. */}
          <ModuleGated feature="waf">
            <Switch
              label={t("enableWebApplicationFirewall")}
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
                  label={t("globalRuleHandling")}
                  value={wafMode}
                  onChange={(next) => setWafMode(next as WafMode)}
                >
                  <SegmentedControlItem value="merge" label={t("mergeWithGlobal")} />
                  <SegmentedControlItem value="override" label={t("overrideGlobal")} />
                </SegmentedControl>
                <Divider />
              </>
            )}
            {!showModeSelector && <Divider />}

            <SegmentedControl
              label={t("engineMode")}
              value={engineMode}
              onChange={(next) => setEngineMode(next as EngineMode)}
            >
              <SegmentedControlItem value="inherit" label={t("globalDefault")} />
              <SegmentedControlItem value="Off" label={t("off")} />
              <SegmentedControlItem value="On" label={t("on")} />
            </SegmentedControl>

            <Divider />

            <CheckboxInput
              label={t("owaspCrsLabel")}
              description={t("owaspCrsHelp")}
              value={loadCrs}
              onChange={setLoadCrs}
            />

            <Divider />

            <VStack gap={2}>
              <Text type="body" size="sm" weight="bold">
                {t("requestBodyLimits")}
              </Text>
              <Text type="body" size="xsm" color="secondary">
                {t("wafBodyLimitsDescription")}
              </Text>
              <HStack gap={3} vAlign="start" wrap="wrap">
                <NumberInput
                  label={`Max body size (MiB, up to ${MAX_BODY_LIMIT_MIB})`}
                  value={bodyLimitMb}
                  onChange={setBodyLimitMb}
                  min={MIN_BODY_LIMIT_MIB}
                  max={MAX_BODY_LIMIT_MIB}
                  step={1}
                  isIntegerOnly
                  hasClear
                  placeholder={t("inherit")}
                />
                <NumberInput
                  label={t("bufferedInMemoryMib")}
                  value={inMemoryLimitMb}
                  onChange={setInMemoryLimitMb}
                  min={MIN_BODY_LIMIT_MIB}
                  max={MAX_BODY_LIMIT_MIB}
                  step={1}
                  isIntegerOnly
                  hasClear
                  placeholder={t("inherit")}
                />
              </HStack>
              <SegmentedControl
                label={t("overLimitAction")}
                value={limitAction}
                onChange={(next) => setLimitAction(next as LimitAction)}
              >
                <SegmentedControlItem value="inherit" label={t("inherit")} />
                <SegmentedControlItem value="Reject" label={t("reject")} />
                <SegmentedControlItem value="ProcessPartial" label={t("partial")} />
              </SegmentedControl>
              <Text type="body" size="xsm" color="secondary">
                {t("wafOverLimitActionHelp")}
              </Text>
            </VStack>

            <Divider />

            <WafRuleExclusions value={value?.excluded_rule_ids} />

            <CodeEditor
              label={t("customSeclangDirectives")}
              language="seclang"
              placeholder={`SecRule REQUEST_URI "@contains /secret" "id:9001,deny,status:403,log,msg:'Blocked path'"`}
              value={customDirectives}
              onChange={setCustomDirectives}
              height="sm"
              description={t("customWafDirectivesHelp")}
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
