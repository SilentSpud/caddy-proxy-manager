"use client";

import { useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Card } from "@astryxdesign/core/Card";
import { Divider } from "@astryxdesign/core/Divider";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/Stack";
import { Switch } from "@/src/components/ui/FormBooleanControls";
import { useTranslations } from "next-intl";

type ToggleSetting = {
  stateKey: "hstsSubdomains" | "skipHttpsHostnameValidation";
  fieldName: "hstsSubdomains" | "skipHttpsHostnameValidation";
  labelKey: "hstsSubdomains" | "skipHttpsValidation";
  descriptionKey: "hstsSubdomainsHelp" | "skipHttpsValidationHelp";
};

type SettingsTogglesProps = {
  hstsSubdomains?: boolean;
  skipHttpsValidation?: boolean;
  enabled?: boolean;
  /**
   * Off for the managed dashboard host, whose on/off switch is its own setting - and whose form
   * already posts an `enabled` field this one would collide with.
   */
  showEnabled?: boolean;
};

const SETTINGS: ToggleSetting[] = [
  {
    stateKey: "hstsSubdomains",
    fieldName: "hstsSubdomains",
    labelKey: "hstsSubdomains",
    descriptionKey: "hstsSubdomainsHelp",
  },
  {
    stateKey: "skipHttpsHostnameValidation",
    fieldName: "skipHttpsHostnameValidation",
    labelKey: "skipHttpsValidation",
    descriptionKey: "skipHttpsValidationHelp",
  },
];

export function SettingsToggles({
  hstsSubdomains = true,
  skipHttpsValidation = false,
  enabled = true,
  showEnabled = true,
}: SettingsTogglesProps) {
  const t = useTranslations("proxyHosts");
  const [values, setValues] = useState({
    hstsSubdomains,
    skipHttpsHostnameValidation: skipHttpsValidation,
    enabled,
  });

  const handleChange = (name: keyof typeof values) => (checked: boolean) =>
    setValues((prev) => ({ ...prev, [name]: checked }));

  return (
    <VStack gap={6}>
      {showEnabled && (
        <>
          <input type="hidden" name="enabledPresent" value="1" />
          <input type="hidden" name="enabled" value={values.enabled ? "on" : ""} />

          {/* Banner carries the enabled/paused state semantically, replacing a
              border and background tinted with primary/5 when active. */}
          <Banner
            status={values.enabled ? "success" : "warning"}
            title={values.enabled ? t("proxyHostEnabledTitle") : t("proxyHostPausedTitle")}
            description={
              values.enabled ? t("proxyHostActiveDescription") : t("proxyHostPausedDescription")
            }
            endContent={
              <Switch
                label={t("proxyHostEnabled")}
                isLabelHidden
                value={values.enabled}
                onChange={handleChange("enabled")}
              />
            }
          />
        </>
      )}

      <Card>
        <VStack gap={3}>
          <Text type="body" size="sm" weight="semibold">
            {t("advancedOptions")}
          </Text>
          <Divider />
          {SETTINGS.map((setting, index) => (
            <VStack key={setting.stateKey} gap={3}>
              {index > 0 && <Divider />}
              <input type="hidden" name={`${setting.fieldName}Present`} value="1" />
              <Switch
                label={t(setting.labelKey)}
                description={t(setting.descriptionKey)}
                htmlName={setting.fieldName}
                labelPosition="start"
                labelSpacing="spread"
                value={values[setting.stateKey]}
                onChange={handleChange(setting.stateKey)}
              />
            </VStack>
          ))}
        </VStack>
      </Card>
    </VStack>
  );
}
