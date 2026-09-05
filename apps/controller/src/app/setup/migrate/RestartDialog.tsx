"use client";

/**
 * What happens between the import finishing and the operator signing in.
 *
 * The app read its configuration from an empty database when it started, and the migration has
 * just replaced that database underneath it — settings are cached, the enabled OAuth providers
 * were listed at boot, the environment backfill already decided what this deployment looks like.
 * Going straight to the login page means signing in to a process still running on the old answers,
 * and what an operator sees then is their proxy hosts with none of their settings and no reason to
 * suspect a restart would fix it.
 *
 * So the restart is part of the flow rather than a line in the release notes, and this is the only
 * screen that can say so — a page cannot explain itself while its own server is down.
 *
 * The wait is deliberately in two halves. Waiting only for the app to answer would be satisfied by
 * the process that is still about to exit, so this waits for it to go away first and only then for
 * it to come back. A deployment with no supervisor never comes back, which is a real way to run
 * this app and not an error: after the budget runs out it says so and offers the way forward by
 * hand.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Center } from "@astryxdesign/core/Center";
import { Code } from "@astryxdesign/core/Code";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Heading } from "@astryxdesign/core/Heading";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { Spinner } from "@astryxdesign/core/Spinner";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";

/** How often to ask whether the app is there. Frequent enough to feel immediate, not a flood. */
const POLL_INTERVAL_MS = 1000;
/** How long to wait for the process to go away before assuming nothing is going to stop it. */
const SHUTDOWN_BUDGET_MS = 20_000;
/** How long to wait for it to come back. Generous: a cold start pulls in the whole app. */
const STARTUP_BUDGET_MS = 120_000;

type Phase =
  /** The restart has been asked for and the old process is still answering. */
  | "stopping"
  /** It has gone. Waiting for the supervisor to bring it back. */
  | "starting"
  /** It answered again; the operator is on their way to the next step. */
  | "ready"
  /** Nothing restarted it, or it never came back. The operator finishes by hand. */
  | "stalled";

/** True when the app answered. A failure to connect is the expected reply while it is down. */
async function isUp(): Promise<boolean> {
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function RestartDialog({
  next,
  migratedSignIn,
}: {
  /** Where to send the operator once the app is back. */
  next: string;
  /** Whether the migration brought something that can sign in, which changes what comes next. */
  migratedSignIn: boolean;
}) {
  const [phase, setPhase] = useState<Phase>("stopping");
  const [detail, setDetail] = useState<string | null>(null);
  // Strict Mode mounts effects twice in development, and asking a process to exit twice is not
  // something to leave to chance.
  const started = useRef(false);

  const goOn = useCallback(() => {
    // A full load rather than a router push: the process serving this page is not the one that
    // will serve the next, and nothing client-side should be carried across.
    window.location.assign(next);
  }, [next]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch("/api/setup/restart", { method: "POST" });
        if (!response.ok && response.status !== 202) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          if (!cancelled) {
            setDetail(body?.error ?? `The restart request was refused (HTTP ${response.status}).`);
            setPhase("stalled");
          }
          return;
        }
      } catch {
        // The connection dropping as the process exits is a normal outcome here, not a failure:
        // the request did its job on the way out. The polling below is what decides.
      }

      // Down first. Accepting the first successful poll would accept the process that is still on
      // its way out, and send the operator to a page about to be served by nobody.
      const shutdownBy = Date.now() + SHUTDOWN_BUDGET_MS;
      while (!cancelled && Date.now() < shutdownBy) {
        if (!(await isUp())) break;
        await sleep(POLL_INTERVAL_MS);
      }
      if (cancelled) return;

      if (await isUp()) {
        setDetail(
          "The application is still running after being asked to stop, so nothing appears to be " +
            "supervising it.",
        );
        setPhase("stalled");
        return;
      }

      setPhase("starting");

      const startupBy = Date.now() + STARTUP_BUDGET_MS;
      while (!cancelled && Date.now() < startupBy) {
        if (await isUp()) {
          if (cancelled) return;
          setPhase("ready");
          goOn();
          return;
        }
        await sleep(POLL_INTERVAL_MS);
      }
      if (cancelled) return;

      setDetail("The application stopped but has not come back.");
      setPhase("stalled");
    })();

    return () => {
      cancelled = true;
    };
  }, [goOn]);

  const waiting = phase === "stopping" || phase === "starting" || phase === "ready";

  return (
    <Center>
      <VStack gap={2} padding={5}>
        <Heading level={1}>Migration complete</Heading>
        <Text color="secondary">
          The old database has been copied. One more step before you sign in.
        </Text>
      </VStack>

      <Dialog isOpen onOpenChange={() => {}} width={560} purpose="required">
        <Layout
          header={<DialogHeader title="Restarting to finish the migration" />}
          content={
            <LayoutContent>
              <VStack gap={4}>
                <Text size="sm" color="secondary">
                  Your data is in PostgreSQL. The application is restarting so it runs from it: this
                  process started against an empty database and is still working from what it read
                  then.
                </Text>

                {waiting ? (
                  <HStack gap={3} align="center">
                    <Spinner />
                    <Text size="sm">
                      {phase === "stopping"
                        ? "Stopping the application…"
                        : phase === "starting"
                          ? "Waiting for it to come back…"
                          : "Back up. Taking you to the next step…"}
                    </Text>
                  </HStack>
                ) : (
                  <VStack gap={3}>
                    <Banner
                      status="warning"
                      title="The application did not restart on its own"
                      description={
                        detail
                          ? `${detail} Restart it yourself, then continue — the migration itself is finished and does not need repeating.`
                          : "Restart it yourself, then continue — the migration itself is finished and does not need repeating."
                      }
                    />
                    <Text size="sm" color="secondary">
                      Under Docker Compose that is:
                    </Text>
                    <Code>docker compose restart web</Code>
                  </VStack>
                )}

                <Text size="xsm" color="secondary">
                  {migratedSignIn
                    ? "You will be asked to sign in with one of the accounts that came across, using the password you already had."
                    : "No accounts came across, so the next step is creating the first administrator or configuring single sign-on."}
                </Text>
              </VStack>
            </LayoutContent>
          }
          footer={
            <LayoutFooter>
              <HStack gap={2} justify="end">
                <Button
                  variant={phase === "stalled" ? "primary" : "secondary"}
                  label={phase === "stalled" ? "Continue" : "Continue without waiting"}
                  onClick={goOn}
                />
              </HStack>
            </LayoutFooter>
          }
        />
      </Dialog>
    </Center>
  );
}
