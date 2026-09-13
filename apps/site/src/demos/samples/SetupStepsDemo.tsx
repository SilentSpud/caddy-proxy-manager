import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { SetupSteps } from "@cpm/controller/src/components/ui/SetupSteps";
import type { SetupStage } from "@cpm/controller/src/lib/setup";
import { DemoSurface } from "../DemoSurface";

/** Every stage in the order a deployment reaches them, `complete` included. */
const STAGES: SetupStage[] = ["migrate", "account", "verify", "settings", "complete"];

/**
 * Where each stage is served, as `SETUP_PATHS` in lib/setup.ts has them. Repeated rather than
 * imported: that module reads the database, and importing it would pull the database into the
 * browser bundle.
 */
const PATHS: Record<SetupStage, string> = {
  migrate: "/setup/migrate",
  account: "/setup",
  verify: "/login",
  settings: "/setup/settings",
  complete: "/",
};

/**
 * The stepper every setup screen carries.
 *
 * In the app nothing steps it: the stage is derived from what exists on the host, and each page
 * renders the stepper for its own stage. The buttons here stand in for doing each step, and the
 * checkbox for whether a previous version's database was found - the only thing that adds a step.
 */
export default function SetupStepsDemo() {
  const [hasMigrateStep, setHasMigrateStep] = useState(true);
  const [index, setIndex] = useState(0);
  const stages = hasMigrateStep ? STAGES : STAGES.filter((stage) => stage !== "migrate");
  const stage = stages[Math.min(index, stages.length - 1)] ?? "account";

  return (
    <DemoSurface>
      <VStack gap={4}>
        <SetupSteps stage={stage} hasMigrateStep={hasMigrateStep} />
        <Text type="body" size="sm" color="secondary">
          {stage === "complete" ? "Setup is finished. " : "Served at "}
          <Text type="code" size="sm">
            {PATHS[stage]}
          </Text>
        </Text>
        <HStack justify="between" vAlign="center" gap={3} wrap="wrap">
          <CheckboxInput
            label="A pre-3.0 database is on this host"
            value={hasMigrateStep}
            onChange={(checked) => {
              setHasMigrateStep(checked);
              setIndex(0);
            }}
          />
          <HStack gap={2}>
            <Button
              variant="secondary"
              size="sm"
              label="Back"
              isDisabled={index === 0}
              onClick={() => setIndex((current) => Math.max(0, current - 1))}
            />
            <Button
              variant="primary"
              size="sm"
              label={stage === "settings" ? "Save" : "Next"}
              isDisabled={stage === "complete"}
              onClick={() => setIndex((current) => Math.min(stages.length - 1, current + 1))}
            />
          </HStack>
        </HStack>
      </VStack>
    </DemoSurface>
  );
}
