"use client";

/**
 * Where the operator is in first-run setup.
 *
 * The steps are the stages from `lib/setup.ts`, not a list of its own: the flow is derived from
 * what exists on the host rather than tracked as a counter, so a stepper with its own idea of the
 * sequence would disagree with the redirects the moment one of them fires.
 *
 * `migrate` is conditional because it only exists when a previous version's database is on the
 * host, and `verify` is a real stage even though it lives at `/login` - an account that has never
 * been signed in with is not yet proof the flow can continue. `/setup/done` is deliberately absent:
 * it is reached after setup completes, so it is not a step on the way there.
 */
import { Stepper, Step } from "@astryxdesign/core/Stepper";
import { useTranslations } from "next-intl";
import type { SetupStage } from "@/src/lib/setup";

/** The stages an operator walks, in order. `complete` is the absence of a step, not one. */
const STEP_ORDER = ["migrate", "account", "verify", "settings"] as const;

type StepStage = (typeof STEP_ORDER)[number];

export function SetupSteps({
  stage,
  hasMigrateStep,
}: {
  stage: SetupStage;
  /** True when a legacy database is on the host, which is the only thing that adds the step. */
  hasMigrateStep: boolean;
}) {
  const t = useTranslations("setup.steps");
  const stages = STEP_ORDER.filter((entry) => entry !== "migrate" || hasMigrateStep);
  const active = stages.indexOf(stage as StepStage);

  // `complete` reaches this on /setup/done, where every step is behind the operator.
  const activeStep = active === -1 ? stages.length : active;

  return (
    <Stepper activeStep={activeStep} label={t("label")}>
      {stages.map((entry, index) => (
        <Step key={entry} step={index} label={t(entry)} />
      ))}
    </Stepper>
  );
}
