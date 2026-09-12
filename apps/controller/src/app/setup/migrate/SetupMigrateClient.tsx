"use client";

/**
 * The migration offer: which old database, how much of it, or none at all.
 *
 * Every candidate is shown with what is actually in it - users, proxy hosts, certificates, and
 * when it was last written - because on a host with a backup beside the live file those counts are
 * the only way to tell them apart, and choosing wrong migrates the wrong data with nothing to
 * signal it afterwards.
 *
 * The groups below are the same question at a finer grain. The one people actually come here to
 * answer is whether to keep the old accounts: an installation being handed to someone else wants
 * the proxy hosts and none of the users, and before this it was all or nothing.
 */
import { useMemo, useRef, useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { BottomSheet } from "@astryxdesign/core/BottomSheet";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Center } from "@astryxdesign/core/Center";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { Heading } from "@astryxdesign/core/Heading";
import { SelectableCard } from "@astryxdesign/core/SelectableCard";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { FormCard, StatusAlert } from "@/src/components/ui/FormLayout";
import { SetupSteps } from "@/src/components/ui/SetupSteps";
import { AUTOFILL_OFF } from "@/src/components/ui/native-input-attrs";
import {
  ALL_MIGRATION_GROUP_IDS,
  MIGRATION_GROUPS,
  type MigrationGroupId,
  withRequiredGroups,
} from "@/src/lib/migration/selection";
import { skipMigration } from "./actions";
import RestartDialog from "./RestartDialog";
import { useTranslations } from "next-intl";

export type Candidate = {
  path: string;
  sizeBytes: number;
  users: number;
  proxyHosts: number;
  certificates: number;
  groupCounts: Record<MigrationGroupId, number>;
  lastUpdatedAt: string | null;
  /**
   * Whether this file's secrets are encrypted with a `SESSION_SECRET` this deployment does not
   * have - decided on the server, which is the only side that can try the key.
   */
  needsLegacyKey: boolean;
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A label and the value it settles, for the confirmation summary. */
function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <HStack gap={3} justify="between" align="center">
      <Text size="sm" color="secondary">
        {label}
      </Text>
      <Text size="sm" weight="medium">
        {value}
      </Text>
    </HStack>
  );
}

export default function SetupMigrateClient({
  candidates,
  rejected,
}: {
  candidates: Candidate[];
  rejected: Array<{ path: string; reason: string }>;
}) {
  const t = useTranslations("setup");
  const [selected, setSelected] = useState(candidates[0]?.path ?? "");
  // Everything, to start: an operator who reads none of this and presses the button gets the
  // migration they would have got before there was anything to choose.
  const [picked, setPicked] = useState<MigrationGroupId[]>(ALL_MIGRATION_GROUP_IDS);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  // The old deployment's SESSION_SECRET, when this file's secrets need one. Held only long enough
  // to be posted: the import re-encrypts everything under the current key, so nothing keeps it.
  const [legacyKey, setLegacyKey] = useState("");
  // Set when the server asks for the key despite the probe not having done so - a database whose
  // secret was rotated more than once, where the sample read but something later did not.
  const [keyDemanded, setKeyDemanded] = useState(false);
  // Set once the import has succeeded, which swaps the page for the restart dialog.
  const [imported, setImported] = useState<{ next: string; migratedSignIn: boolean } | null>(null);
  // The confirmation sheet, and the form it submits from outside itself.
  const [confirming, setConfirming] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const candidate = candidates.find((entry) => entry.path === selected);

  /**
   * What will actually be migrated, and which of it the operator no longer controls.
   *
   * A group that something ticked depends on is shown ticked and locked rather than quietly added:
   * "Certificates" turning itself on the moment proxy hosts are chosen is only confusing if the
   * checkbox does not say why it happened.
   */
  const { effective, lockedBy } = useMemo(() => {
    const resolved = new Set(withRequiredGroups(picked));
    const locks = new Map<MigrationGroupId, string[]>();
    const chosen = new Set(picked);

    for (const group of MIGRATION_GROUPS) {
      if (!chosen.has(group.id)) continue;
      for (const required of withRequiredGroups([group.id])) {
        if (required === group.id) continue;
        locks.set(required, [...(locks.get(required) ?? []), group.label]);
      }
    }

    return { effective: resolved, lockedBy: locks };
  }, [picked]);

  async function runMigration(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setRunning(true);
    // Out of the way before anything can fail: the error banner sits on the page behind the
    // sheet, so leaving it open would hide the only explanation of what went wrong.
    setConfirming(false);

    try {
      const response = await fetch("/api/setup/migrate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: selected, groups: [...effective], legacyKey }),
      });
      const body = (await response.json()) as
        | { ok: true; next: string; migratedSignIn: boolean }
        | { ok: false; error: string; code?: "legacy-key-required" | "legacy-key-invalid" };

      if (!body.ok) {
        setError(body.error);
        // Either code means the field belongs on screen: the first because the server found
        // secrets the probe did not, the second so a mistyped key can be corrected in place.
        if (body.code) setKeyDemanded(true);
        return;
      }
      setImported({ next: body.next, migratedSignIn: body.migratedSignIn });
    } catch {
      // The import copies thirty tables and can outlast a proxy's idle timeout. Saying so beats a
      // bare "failed", because trying again on a half-populated database is the one thing not to
      // do here.
      setError(
        "The connection dropped before the migration reported back. Check whether it completed " +
          "before running it again: a second run against a partly populated database is not " +
          "supported.",
      );
    } finally {
      setRunning(false);
    }
  }

  function toggle(id: MigrationGroupId, checked: boolean): void {
    setPicked((current) =>
      checked ? [...new Set([...current, id])] : current.filter((entry) => entry !== id),
    );
  }

  const migratingUsers = effective.has("users");
  const migratingOAuth = effective.has("oauthProviders");
  // The probe answers for the file; `keyDemanded` is the server having asked anyway. Once the field
  // is on screen it stays, so a wrong key does not make the box the operator is fixing disappear.
  const needsLegacyKey = (candidate?.needsLegacyKey ?? false) || keyDemanded;
  const blocked = effective.size === 0 || running || (needsLegacyKey && !legacyKey.trim());

  /**
   * What the confirmation counts. Split on `effective` rather than `picked`, so a group that was
   * locked on by a dependency is counted as coming across - which is what will happen.
   */
  const { copying, leaving } = useMemo(() => {
    const tally = (included: boolean) =>
      MIGRATION_GROUPS.filter((group) => effective.has(group.id) === included).reduce(
        (sum, group) => ({
          groups: sum.groups + 1,
          rows: sum.rows + (candidate?.groupCounts?.[group.id] ?? 0),
        }),
        { groups: 0, rows: 0 },
      );
    return { copying: tally(true), leaving: tally(false) };
  }, [effective, candidate]);

  if (imported) {
    return <RestartDialog next={imported.next} migratedSignIn={imported.migratedSignIn} />;
  }

  return (
    <Center>
      <VStack gap={5} padding={5}>
        <SetupSteps stage="migrate" hasMigrateStep />
        <VStack gap={2}>
          <Heading level={1}>{t("migrate.heading")}</Heading>
          <Text color="secondary">{t("migrationDescription")}</Text>
        </VStack>

        {error && <StatusAlert message={error} success={false} />}

        <form ref={formRef} onSubmit={runMigration}>
          <VStack gap={4}>
            <FormCard title={t("databasesFound")}>
              <VStack gap={3}>
                {candidates.map((entry) => {
                  const isSelected = selected === entry.path;
                  return (
                    <SelectableCard
                      key={entry.path}
                      variant="muted"
                      padding={3}
                      width="100%"
                      label={entry.path}
                      isSelected={isSelected}
                      onChange={() => setSelected(entry.path)}
                    >
                      <VStack gap={1} align="start">
                        <Text size="sm" weight="medium">
                          {entry.path}
                        </Text>
                        <HStack gap={3}>
                          <Text size="xsm" color="secondary">
                            {entry.users} user(s)
                          </Text>
                          <Text size="xsm" color="secondary">
                            {entry.proxyHosts} proxy host(s)
                          </Text>
                          <Text size="xsm" color="secondary">
                            {entry.certificates} certificate(s)
                          </Text>
                          <Text size="xsm" color="secondary">
                            {formatSize(entry.sizeBytes)}
                          </Text>
                        </HStack>
                        {entry.lastUpdatedAt && (
                          <Text size="xsm" color="secondary">
                            Last written {entry.lastUpdatedAt}
                          </Text>
                        )}
                      </VStack>
                    </SelectableCard>
                  );
                })}
              </VStack>
            </FormCard>

            {rejected.length > 0 && (
              <FormCard title={t("skippedFilesTitle")}>
                <VStack gap={2}>
                  {rejected.map((entry) => (
                    <Text key={entry.path} size="xsm" color="secondary">
                      {entry.path} - {entry.reason}
                    </Text>
                  ))}
                </VStack>
              </FormCard>
            )}

            <FormCard title={t("whatToMigrate")}>
              <VStack gap={3}>
                <Text size="sm" color="secondary">
                  {t("migrationSelectionHelp")}
                </Text>
                {MIGRATION_GROUPS.map((group) => {
                  const requiredBy = lockedBy.get(group.id);
                  const rows = candidate?.groupCounts?.[group.id];
                  const suffix = rows === undefined ? "" : ` - ${rows} row(s)`;
                  return (
                    <CheckboxInput
                      key={group.id}
                      label={`${group.label}${suffix}`}
                      description={
                        requiredBy
                          ? `${group.description} Required by ${requiredBy.join(", ")}.`
                          : group.description
                      }
                      value={effective.has(group.id)}
                      isDisabled={requiredBy !== undefined}
                      disabledMessage={
                        requiredBy && `Untick ${requiredBy.join(", ")} first to leave this behind.`
                      }
                      onChange={(checked) => toggle(group.id, checked)}
                    />
                  );
                })}
              </VStack>
            </FormCard>

            {!migratingUsers && (
              <Banner
                status="info"
                title={t("accountsExcludedTitle")}
                description={
                  migratingOAuth
                    ? "Your old users, passwords and API tokens stay behind. You will be taken to create the first administrator next - unless one of the migrated OAuth providers is enabled, in which case you can sign in through it instead."
                    : "Your old users, passwords and API tokens stay behind. You will be taken to create the first administrator, or configure single sign-on, on the next screen."
                }
              />
            )}

            {needsLegacyKey && (
              <FormCard title={t("legacySecretRequiredTitle")}>
                <VStack gap={3}>
                  <Text size="sm" color="secondary">
                    Certificate private keys, DNS provider credentials, OAuth client secrets and
                    agent secrets in this file are encrypted with the <code>SESSION_SECRET</code>{" "}
                    the old installation ran with, and this deployment has a different one. Enter
                    the old value to bring them across.
                  </Text>
                  <TextInput
                    {...AUTOFILL_OFF}
                    label={t("legacySecretLabel")}
                    htmlName="legacyKey"
                    type="password"
                    description={t("legacySecretHelp")}
                    value={legacyKey}
                    onChange={setLegacyKey}
                    isRequired
                    width="100%"
                  />
                  <Banner
                    status="info"
                    title={t("secretReencryptionTitle")}
                    description={t("secretReencryptionDescription")}
                  />
                </VStack>
              </FormCard>
            )}

            <Banner
              status="warning"
              title={t("emptyDatabaseRequiredTitle")}
              description={t("emptyDatabaseRequiredDescription")}
            />

            {/* Opens the confirmation rather than submitting: the import is one-way, and the
                selection above is easy to get wrong in a way nothing later can undo. */}
            <Button
              variant="primary"
              label={running ? t("migrate.submitPending") : t("migrate.submit")}
              isDisabled={blocked}
              onClick={() => setConfirming(true)}
            />
          </VStack>
        </form>

        <BottomSheet
          label={t("migrate.confirmTitle")}
          isOpen={confirming}
          onOpenChange={setConfirming}
          // A swipe or a scrim tap is the same answer as Cancel here, so nothing is blocked.
          purpose="info"
        >
          {/* Only while open: the sheet stays mounted for its own motion, and its copy repeats
              the page's - a closed sheet contributing a second copy of the chosen path is a
              duplicate for find-in-page, for a screen reader, and for any locator. */}
          {confirming && (
            <VStack gap={4} padding={4}>
              <VStack gap={2}>
                <Heading level={2}>{t("migrate.confirmTitle")}</Heading>
                <Text color="secondary">{t("migrate.confirmDescription")}</Text>
              </VStack>

              <Card>
                <VStack gap={3} padding={3}>
                  <SummaryRow label={t("migrate.confirmSource")} value={selected} />
                  <SummaryRow
                    label={t("migrate.confirmCopying")}
                    value={t("migrate.confirmGroups", {
                      groups: copying.groups,
                      rows: copying.rows,
                    })}
                  />
                  <SummaryRow
                    label={t("migrate.confirmLeaving")}
                    value={
                      leaving.groups === 0
                        ? t("migrate.confirmNothing")
                        : t("migrate.confirmGroups", { groups: leaving.groups, rows: leaving.rows })
                    }
                  />
                  <SummaryRow
                    label={t("migrate.confirmSecrets")}
                    value={
                      needsLegacyKey
                        ? t("migrate.confirmSecretsReencrypted")
                        : t("migrate.confirmSecretsUnchanged")
                    }
                  />
                </VStack>
              </Card>

              {!migratingUsers && (
                <Banner
                  status="warning"
                  title={t("migrate.confirmNoAccountsTitle")}
                  description={t("migrate.confirmNoAccountsDescription")}
                />
              )}

              <Text size="sm" color="secondary">
                {t("migrate.confirmFootnote")}
              </Text>

              <VStack gap={2}>
                <Button
                  variant="primary"
                  // Named for the outcome rather than repeating the trigger: two buttons with the
                  // same accessible name is ambiguous to a screen reader.
                  label={t("migrate.confirmStart")}
                  isDisabled={blocked}
                  // requestSubmit rather than a submit button: the sheet renders in its own dialog,
                  // so a button inside it is not associated with the form above.
                  onClick={() => formRef.current?.requestSubmit()}
                />
                <Button
                  variant="secondary"
                  label={t("migrate.confirmCancel")}
                  onClick={() => setConfirming(false)}
                />
              </VStack>
            </VStack>
          )}
        </BottomSheet>

        <FormCard title={t("orStartFresh")}>
          <VStack gap={3}>
            <Text size="sm" color="secondary">
              {t("skipMigrationDescription")}
            </Text>
            <form action={skipMigration}>
              <Button type="submit" variant="secondary" size="sm" label={t("skipMigrationLabel")} />
            </form>
          </VStack>
        </FormCard>
      </VStack>
    </Center>
  );
}
