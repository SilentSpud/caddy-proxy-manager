"use client";

/**
 * What a migrated deployment is owed once setup finishes: its old database back, and the command
 * that clears the migrated variables out of the `.env` it still has.
 */
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Center } from "@astryxdesign/core/Center";
import { Code } from "@astryxdesign/core/Code";
import { Heading } from "@astryxdesign/core/Heading";
import { Link } from "@astryxdesign/core/Link";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import type { EnvCleanup } from "@/src/lib/migration/env-file";
import { FormCard } from "@/src/components/ui/FormLayout";

export default function SetupDoneClient({
  source,
  cleanup,
}: {
  source: string;
  cleanup: EnvCleanup;
}) {
  return (
    <Center>
      <VStack gap={5} padding={5}>
        <VStack gap={2}>
          <Heading level={1}>Migration complete</Heading>
          <Text color="secondary">
            Everything you chose to bring across is now in PostgreSQL, and the application is
            running from it.
          </Text>
        </VStack>

        <FormCard title="Keep a copy of the old database">
          <VStack gap={3}>
            <Text size="sm" color="secondary">
              The file at <Code>{source}</Code> was read, not modified. Download it now if you want
              a copy — once you are satisfied the migration is correct, it can be deleted.
            </Text>
            <Banner
              status="warning"
              title="Nothing reads this file any more"
              description="The application no longer opens it, so any change made there from now on is invisible to it."
            />
            <Link href="/api/setup/backup">Download the old database</Link>
          </VStack>
        </FormCard>

        <FormCard title="Tidy up your .env">
          {cleanup.command ? (
            <VStack gap={3}>
              <Text size="sm" color="secondary">
                These are stored in the database now and are no longer read from the environment:{" "}
                <Code>{cleanup.comment.join(" ")}</Code>. Run this beside your{" "}
                <Code>docker-compose.yml</Code> to comment them out of your <Code>.env</Code>. It
                edits nothing else, leaves a <Code>.env.bak</Code> next to it, and comments rather
                than deletes so you keep a copy of the values.
              </Text>
              <Code>{cleanup.command}</Code>
              <Text size="sm" color="secondary">
                If this deployment's environment comes from somewhere else — Compose's own{" "}
                <Code>environment:</Code> block, Swarm or Kubernetes secrets, a systemd unit —
                remove those variables from wherever you set them instead. Either way it is
                optional: a variable that is still set is simply ignored now that a value is stored.
              </Text>
            </VStack>
          ) : (
            <Text size="sm" color="secondary">
              Nothing to remove — none of the settings you migrated were configured by an
              environment variable.
            </Text>
          )}

          {cleanup.keep.length > 0 && (
            <Banner
              status="warning"
              title="Compose reads these too"
              description={`Docker Compose provisions the clickhouse and geoipupdate containers from ${cleanup.keep.join(", ")}, and it cannot read the database — so the command above leaves them alone. Without an agent they have to stay: Docker is the only thing that can start those containers there. With an agent the saved values are passed to Compose for you, and these lines can go as well — but drop clickhouse and geoipupdate from COMPOSE_PROFILES at the same time, or your own docker compose up -d keeps recreating the containers from the now-stale values in the file.`}
            />
          )}
        </FormCard>

        <Button
          variant="primary"
          label="Go to the dashboard"
          onClick={() => window.location.assign("/")}
        />
      </VStack>
    </Center>
  );
}
