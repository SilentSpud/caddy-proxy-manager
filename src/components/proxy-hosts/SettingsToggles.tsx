"use client";

import { useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Card } from "@astryxdesign/core/Card";
import { Divider } from "@astryxdesign/core/Divider";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/Stack";

type ToggleSetting = {
  stateKey: "hstsSubdomains" | "skipHttpsHostnameValidation";
  fieldName: "hstsSubdomains" | "skipHttpsHostnameValidation";
  label: string;
  description: string;
};

type SettingsTogglesProps = {
  hstsSubdomains?: boolean;
  skipHttpsValidation?: boolean;
  enabled?: boolean;
};

const SETTINGS: ToggleSetting[] = [
  {
    stateKey: "hstsSubdomains",
    fieldName: "hstsSubdomains",
    label: "HSTS Subdomains",
    description: "Include subdomains in the Strict-Transport-Security header",
  },
  {
    stateKey: "skipHttpsHostnameValidation",
    fieldName: "skipHttpsHostnameValidation",
    label: "Skip HTTPS Validation",
    description: "Skip SSL certificate hostname verification for backend connections",
  },
];

export function SettingsToggles({
  hstsSubdomains = true,
  skipHttpsValidation = false,
  enabled = true,
}: SettingsTogglesProps) {
  const [values, setValues] = useState({
    hstsSubdomains,
    skipHttpsHostnameValidation: skipHttpsValidation,
    enabled,
  });

  const handleChange = (name: keyof typeof values) => (checked: boolean) =>
    setValues((prev) => ({ ...prev, [name]: checked }));

  return (
    <VStack gap={6}>
      <input type="hidden" name="enabledPresent" value="1" />
      <input type="hidden" name="enabled" value={values.enabled ? "on" : ""} />

      {/* Banner carries the enabled/paused state semantically, replacing a
          border and background tinted with primary/5 when active. */}
      <Banner
        status={values.enabled ? "success" : "warning"}
        title={values.enabled ? "Proxy Host Enabled" : "Proxy Host Paused"}
        description={
          values.enabled
            ? "This host is active and routing traffic"
            : "This host is disabled and will not respond to requests"
        }
        endContent={
          <Switch
            label="Proxy host enabled"
            isLabelHidden
            value={values.enabled}
            onChange={handleChange("enabled")}
          />
        }
      />

      <Card>
        <VStack gap={3}>
          <Text type="body" size="sm" weight="semibold">
            Advanced Options
          </Text>
          <Divider />
          {SETTINGS.map((setting, index) => (
            <VStack key={setting.stateKey} gap={3}>
              {index > 0 && <Divider />}
              <input type="hidden" name={`${setting.fieldName}Present`} value="1" />
              <Switch
                label={setting.label}
                description={setting.description}
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
