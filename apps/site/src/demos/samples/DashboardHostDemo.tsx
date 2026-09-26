import { useActionState, useState } from "react";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { VStack } from "@astryxdesign/core/Stack";
import { DashboardHostSection } from "@cpm/controller/src/app/(dashboard)/settings/DashboardHostSection";
import type {
  DashboardDnsCheck,
  DashboardHostSettings,
} from "@cpm/controller/src/lib/dashboard-host";
import { DemoSurface } from "../DemoSurface";
import { t } from "../catalog";

type Answer = "reached" | "otherServer" | "unresolved";

const HOSTNAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/i;

/** What `checkDashboardDns` finds for each answer the reader can pick. */
const CHECKS: Record<Answer, DashboardDnsCheck> = {
  reached: { ok: true, resolved: ["203.0.113.10"], reason: "reached" },
  otherServer: { ok: false, resolved: ["198.51.100.24"], reason: "otherServer" },
  unresolved: { ok: false, resolved: [], reason: "unresolved" },
};

/**
 * Settings → Dashboard Host, with the save and the reachability check answered in the browser.
 *
 * The check really runs against the saved domain rather than the field - the section enforces that
 * itself - so what the reader picks above is what the world would say about that saved name. The
 * proxy options are left out: they are the proxy host editor's fields, demoed on its own page.
 */
export default function DashboardHostDemo() {
  const [answer, setAnswer] = useState<Answer>("reached");
  const [saved, setSaved] = useState<DashboardHostSettings>({
    enabled: true,
    domain: "cpm.example.com",
    tls: false,
  });

  const [state, formAction] = useActionState(
    async (_previous: { success: boolean; message?: string } | null, formData: FormData) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const domain = String(formData.get("domain") ?? "").trim();
      if (!HOSTNAME.test(domain)) {
        return { success: false, message: t("setup.errors.dashboardDomainInvalid") };
      }
      setSaved((current) => ({
        ...current,
        enabled: formData.get("enabled") === "on",
        domain,
        tls: formData.get("tls") === "on",
      }));
      return { success: true, message: t("settings.results.dashboardSaved") };
    },
    null,
  );

  return (
    <DemoSurface>
      <VStack gap={4}>
        <SegmentedControl
          label="Where the domain points"
          value={answer}
          onChange={(value) => setAnswer(value as Answer)}
          layout="fill"
        >
          <SegmentedControlItem value="reached" label="This deployment" />
          <SegmentedControlItem value="otherServer" label="Another server" />
          <SegmentedControlItem value="unresolved" label="Nowhere yet" />
        </SegmentedControl>
        <DashboardHostSection
          dashboard={saved}
          options={null}
          dashboardState={state}
          dashboardFormAction={formAction}
          checkDns={async () => {
            await new Promise((resolve) => setTimeout(resolve, 900));
            return CHECKS[answer];
          }}
        />
      </VStack>
    </DemoSurface>
  );
}
