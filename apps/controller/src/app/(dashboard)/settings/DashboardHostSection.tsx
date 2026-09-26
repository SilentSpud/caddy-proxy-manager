"use client";

import { useEffect, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useTranslations } from "next-intl";
import { AppDialog } from "@/src/components/ui/AppDialog";
import { EnvLabelledField } from "@/src/components/ui/EnvLabelledField";
import { Switch } from "@/src/components/ui/FormBooleanControls";
import {
  FormCard,
  InfoAlert,
  SaveButton,
  StatusAlert,
  WarnAlert,
} from "@/src/components/ui/FormLayout";
import { NO_SPELLCHECK } from "@/components/ui/native-input-attrs";
import {
  DashboardHostOptionsFields,
  type DashboardHostOptionsData,
} from "@/src/components/proxy-hosts/DashboardHostOptionsFields";
import type { DashboardDnsCheck, DashboardHostSettings } from "@/src/lib/dashboard-host";
import { SKIP_PAGE_SAVE } from "./PageBlocks";

/**
 * How this dashboard is served through the Caddy it manages.
 *
 * Two things make this section different from the rest of the page. Turning it off can remove the
 * route the reader is using right now, so it asks first when it can tell that is the case - the
 * page is being served on the very domain about to stop being claimed. And TLS is a question about
 * the world rather than a preference, so the DNS check is offered inline: forcing HTTPS on a name
 * that does not resolve here yet buys nothing but a failing certificate order.
 */
export function DashboardHostSection({
  dashboard,
  options,
  dashboardState,
  dashboardFormAction,
  checkDns,
}: {
  dashboard: DashboardHostSettings;
  options: DashboardHostOptionsData | null;
  dashboardState: { success: boolean; message?: string } | null;
  dashboardFormAction: (payload: FormData) => void;
  /** `checkDashboardDnsAction`, passed in so the docs site can render this without the actions. */
  checkDns: () => Promise<DashboardDnsCheck>;
}) {
  const t = useTranslations("settings");
  const [enabled, setEnabled] = useState(dashboard.enabled);
  const [domain, setDomain] = useState(dashboard.domain);
  const [tls, setTls] = useState(dashboard.tls);
  const [check, setCheck] = useState<DashboardDnsCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [confirmDisable, setConfirmDisable] = useState(false);

  // Whether this page arrived through the route in question. Read after mount rather than during
  // render: the server has no window to ask, so deciding it inline would render one button on the
  // server and a different one in the browser, which is a hydration mismatch. Until it resolves
  // the form behaves normally, which is the safe way round - the worst case is the dialog not
  // appearing for the first instant, not a warning that never appears.
  //
  // Compared against what is stored rather than what is typed: the saved domain is what Caddy is
  // serving right now, and a half-typed replacement says nothing about how the reader got here.
  const [servedThroughProxy, setServedThroughProxy] = useState(false);
  useEffect(() => {
    setServedThroughProxy(
      dashboard.enabled &&
        dashboard.domain.trim().toLowerCase() === window.location.hostname.toLowerCase(),
    );
  }, [dashboard.enabled, dashboard.domain]);

  const losingOwnAccess = servedThroughProxy && !enabled;

  // The check runs against the saved domain, not the field: a request whose host came from the
  // form would be an administrator's keystrokes deciding where the server connects. So a field
  // that has been edited has to be saved before the answer would mean anything.
  const domainIsSaved = domain.trim().toLowerCase() === dashboard.domain.trim().toLowerCase();

  async function runCheck() {
    setChecking(true);
    try {
      const result = await checkDns();
      setCheck(result);
      // The check is the whole reason to trust the answer, so let it set the toggle rather than
      // leaving the operator to read a warning and reproduce its conclusion by hand.
      setTls(result.ok);
    } finally {
      setChecking(false);
    }
  }

  function submit() {
    (document.getElementById("dashboard-host-form") as HTMLFormElement)?.requestSubmit();
  }

  return (
    <>
      <FormCard title={t("dashboardHostTitle")}>
        {/* Kept off the page bar: when the change would cut the reader's own way in, the
            button opens a confirmation and the dialog submits. A bar that submitted the form
            directly would step over that question. */}
        <form id="dashboard-host-form" action={dashboardFormAction} {...SKIP_PAGE_SAVE}>
          <VStack gap={3}>
            {dashboardState?.message && (
              <StatusAlert message={dashboardState.message} success={dashboardState.success} />
            )}
            <Switch
              label={t("dashboardEnabledLabel")}
              description={t("dashboardEnabledHelp")}
              htmlName="enabled"
              value={enabled}
              onChange={setEnabled}
            />
            <EnvLabelledField label={t("dashboardDomainLabel")} env={["DASHBOARD_DOMAIN"]}>
              <TextInput
                {...NO_SPELLCHECK}
                label={t("dashboardDomainLabel")}
                description={t("dashboardDomainHelp")}
                htmlName="domain"
                value={domain}
                onChange={setDomain}
                isRequired
              />
            </EnvLabelledField>
            <HStack gap={2} vAlign="end" wrap="wrap">
              <Button
                variant="secondary"
                type="button"
                onClick={runCheck}
                isDisabled={checking || !domainIsSaved || domain.trim() === ""}
                label={checking ? t("dashboardDnsChecking") : t("dashboardDnsCheckLabel")}
              />
            </HStack>
            {!domainIsSaved && (
              <InfoAlert title={t("dashboardCheckNeedsSaveTitle")}>
                {t("dashboardCheckNeedsSaveDescription")}
              </InfoAlert>
            )}
            {check && <DnsCheckResult check={check} />}
            <Switch
              label={t("dashboardTlsLabel")}
              description={t("dashboardTlsHelp")}
              htmlName="tls"
              value={tls}
              onChange={setTls}
            />
            {tls && check && !check.ok && (
              <WarnAlert title={t("dashboardTlsUnverifiedTitle")}>
                {t("dashboardTlsUnverifiedDescription")}
              </WarnAlert>
            )}
            {options && (
              <Collapsible
                defaultIsOpen={false}
                trigger={<Text size="sm">{t("dashboardProxyOptions")}</Text>}
              >
                <VStack gap={3} padding={2}>
                  <Text size="xsm" color="secondary">
                    {t("dashboardProxyOptionsHelp")}
                  </Text>
                  <DashboardHostOptionsFields data={options} />
                </VStack>
              </Collapsible>
            )}
            {/*
              A plain SaveButton would submit before anything could be said about it, so when the
              reader is about to cut their own route the button asks first and the dialog submits.
            */}
            {losingOwnAccess ? (
              <HStack>
                <Button
                  variant="primary"
                  type="button"
                  onClick={() => setConfirmDisable(true)}
                  label={t("save")}
                />
              </HStack>
            ) : (
              <SaveButton />
            )}
          </VStack>
        </form>
      </FormCard>
      <InfoAlert title={t("dashboardPortEscapeTitle")}>
        {t("dashboardPortEscapeDescription")}
      </InfoAlert>
      <AppDialog
        open={confirmDisable}
        onClose={() => setConfirmDisable(false)}
        title={t("dashboardDisableConfirmTitle")}
        submitLabel={t("dashboardDisableConfirmAction")}
        onSubmit={() => {
          setConfirmDisable(false);
          submit();
        }}
      >
        <VStack gap={3}>
          <WarnAlert title={t("dashboardDisableConfirmTitle")}>
            {t("dashboardDisableConfirmBody", { domain: dashboard.domain })}
          </WarnAlert>
          <Text type="body" size="sm" color="secondary">
            {t("dashboardDisableConfirmRecovery")}
          </Text>
        </VStack>
      </AppDialog>
    </>
  );
}

/** What the reachability check found, in the terms the toggle above it is decided by. */
function DnsCheckResult({ check }: { check: DashboardDnsCheck }) {
  const t = useTranslations("settings");

  if (check.reason === "reached") {
    return (
      <InfoAlert title={t("dashboardDnsMatchTitle")}>{t("dashboardDnsMatchDescription")}</InfoAlert>
    );
  }
  return (
    <WarnAlert
      title={
        check.reason === "unresolved"
          ? t("dashboardDnsUnresolvedTitle")
          : t("dashboardDnsMismatchTitle")
      }
    >
      {check.reason === "unresolved"
        ? t("dashboardDnsUnresolvedDescription")
        : t("dashboardDnsMismatchDescription", { resolved: check.resolved.join(", ") })}
    </WarnAlert>
  );
}
