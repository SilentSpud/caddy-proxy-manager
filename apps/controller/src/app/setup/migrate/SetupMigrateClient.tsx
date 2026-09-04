"use client";

/**
 * The migration offer: which old database, or none.
 *
 * Every candidate is shown with what is actually in it — users, proxy hosts, certificates, and
 * when it was last written — because on a host with a backup beside the live file those counts are
 * the only way to tell them apart, and choosing wrong migrates the wrong data with nothing to
 * signal it afterwards.
 */
import { useActionState, useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Center } from "@astryxdesign/core/Center";
import { Heading } from "@astryxdesign/core/Heading";
import { SelectableCard } from "@astryxdesign/core/SelectableCard";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { FormCard, SaveButton, StatusAlert } from "@/src/components/ui/FormLayout";
import { runMigration, skipMigration } from "./actions";

export type Candidate = {
  path: string;
  sizeBytes: number;
  users: number;
  proxyHosts: number;
  certificates: number;
  lastUpdatedAt: string | null;
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function SetupMigrateClient({
  candidates,
  rejected,
}: {
  candidates: Candidate[];
  rejected: Array<{ path: string; reason: string }>;
}) {
  const [selected, setSelected] = useState(candidates[0]?.path ?? "");
  const [state, submit] = useActionState(runMigration, { error: null });

  return (
    <Center>
      <VStack gap={5} padding={5}>
        <VStack gap={2}>
          <Heading level={1}>Migrate an existing installation</Heading>
          <Text color="secondary">
            A database from a previous version is on this host. Migrating copies its proxy hosts,
            certificates, users and settings into PostgreSQL. The original file is not modified.
          </Text>
        </VStack>

        {state.error && <StatusAlert message={state.error} success={false} />}

        <form action={submit}>
          <VStack gap={4}>
            <FormCard title="Databases found">
              <VStack gap={3}>
                {candidates.map((candidate) => {
                  const isSelected = selected === candidate.path;
                  return (
                    <SelectableCard
                      key={candidate.path}
                      variant="muted"
                      padding={3}
                      width="100%"
                      label={candidate.path}
                      isSelected={isSelected}
                      onChange={() => setSelected(candidate.path)}
                    >
                      <VStack gap={1} align="start">
                        <Text size="sm" weight="medium">
                          {candidate.path}
                        </Text>
                        <HStack gap={3}>
                          <Text size="xsm" color="secondary">
                            {candidate.users} user(s)
                          </Text>
                          <Text size="xsm" color="secondary">
                            {candidate.proxyHosts} proxy host(s)
                          </Text>
                          <Text size="xsm" color="secondary">
                            {candidate.certificates} certificate(s)
                          </Text>
                          <Text size="xsm" color="secondary">
                            {formatSize(candidate.sizeBytes)}
                          </Text>
                        </HStack>
                        {candidate.lastUpdatedAt && (
                          <Text size="xsm" color="secondary">
                            Last written {candidate.lastUpdatedAt}
                          </Text>
                        )}
                      </VStack>
                    </SelectableCard>
                  );
                })}
                <input type="hidden" name="path" value={selected} />
              </VStack>
            </FormCard>

            {rejected.length > 0 && (
              <FormCard title="Files that were skipped">
                <VStack gap={2}>
                  {rejected.map((entry) => (
                    <Text key={entry.path} size="xsm" color="secondary">
                      {entry.path} — {entry.reason}
                    </Text>
                  ))}
                </VStack>
              </FormCard>
            )}

            <Banner
              status="warning"
              title="Migrate into an empty database"
              description="This copies rows with their original identifiers, so it expects nothing to have been created here yet. Running it against a database that is already in use is not supported."
            />

            <SaveButton label="Migrate this database" />
          </VStack>
        </form>

        <FormCard title="Or start fresh">
          <VStack gap={3}>
            <Text size="sm" color="secondary">
              Skip the migration and configure this instance from scratch. The old file is left
              alone, and this offer will not appear again.
            </Text>
            <form action={skipMigration}>
              <Button type="submit" variant="secondary" size="sm" label="Skip and set up fresh" />
            </form>
          </VStack>
        </FormCard>
      </VStack>
    </Center>
  );
}
