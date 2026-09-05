"use client";

/**
 * What a migrated deployment is owed once setup finishes: its old database back, and a `.env` it
 * can safely put in place of the one it has.
 */
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Center } from "@astryxdesign/core/Center";
import { Code } from "@astryxdesign/core/Code";
import { Heading } from "@astryxdesign/core/Heading";
import { Link } from "@astryxdesign/core/Link";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { FormCard } from "@/src/components/ui/FormLayout";

export default function SetupDoneClient({
  source,
  trimmedEnv,
  removed,
}: {
  source: string;
  trimmedEnv: string | null;
  removed: string[];
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

        <FormCard title="Replace your .env">
          {trimmedEnv ? (
            <VStack gap={3}>
              <Text size="sm" color="secondary">
                Everything below marked as migrated now lives in the database and is no longer read
                from the file. They are commented rather than removed so you keep a copy.
              </Text>
              <Code>{trimmedEnv}</Code>
            </VStack>
          ) : (
            <VStack gap={3}>
              <Text size="sm" color="secondary">
                No <Code>.env</Code> file was found beside the application — its environment is
                probably supplied by Compose. These variables are now stored in the database and can
                be removed from wherever you set them:
              </Text>
              <Code>{removed.length > 0 ? removed.join("\n") : "Nothing to remove."}</Code>
            </VStack>
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
