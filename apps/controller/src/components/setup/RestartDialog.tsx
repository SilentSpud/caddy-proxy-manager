"use client";

/**
 * What happens between a setup step finishing and the operator being handed on.
 *
 * Both flows that end in a restart use it. A migration replaces the database underneath a process
 * that read the old one at boot; finishing setup stores configuration a process that started
 * against an empty database has already resolved - settings are cached, the enabled OAuth
 * providers were listed at boot, the environment backfill has decided what this deployment looks
 * like. Going straight on means using a process still running on the old answers, and what an
 * operator sees then is their data with none of their settings and no reason to suspect a restart
 * would fix it. Coming back is also what applies the Caddy configuration, which is how a dashboard
 * host created seconds ago starts answering.
 *
 * So the restart is part of the flow rather than a line in the release notes, and this is the only
 * screen that can say so - a page cannot explain itself while its own server is down. Every word
 * is the caller's: the two flows restart for different reasons and are owed different sentences.
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
import { useTranslations } from "next-intl";
import { loadPage } from "@/src/lib/browser-navigation";

/** How often to ask whether the app is there. Frequent enough to feel immediate, not a flood. */
const POLL_INTERVAL_MS = 1000;
/** How long to wait for the process to go away before assuming nothing is going to stop it. */
const SHUTDOWN_BUDGET_MS = 20_000;
/** How long to wait for it to come back. Generous: a cold start pulls in the whole app. */
const STARTUP_BUDGET_MS = 120_000;
/**
 * How long to keep asking whether the dashboard host answers. Short: the app is already back, so
 * this is only the gap between it starting and Caddy having the route - and every second of it is
 * spent on a page that is finished.
 */
const DASHBOARD_BUDGET_MS = 15_000;
/**
 * How long to respect a cooldown before giving up on it. The route allows one restart a minute, and
 * a deployment that migrated and then finished setup inside that minute is refused for a reason
 * that passes on its own - so it is waited out rather than reported.
 */
const COOLDOWN_BUDGET_MS = 90_000;

/** The words this restart is owed. The two flows share the machinery, not the sentences. */
export type RestartCopy = {
  /** The page heading behind the dialog. */
  heading: string;
  /** The line under it. */
  lead: string;
  /** The dialog's own title and body. */
  title: string;
  description: string;
  /** The footnote: what the operator should expect on the other side. */
  note: string;
  /** What to do when nothing restarted the app, with and without a reason to give. */
  manually: string;
  manuallyWithDetail: (detail: string) => string;
};

type Phase =
  /** The last restart was too recent to ask for another; waiting out its cooldown. */
  | "queued"
  /** The restart has been asked for and the old process is still answering. */
  | "stopping"
  /** It has gone. Waiting for the supervisor to bring it back. */
  | "starting"
  /** It answered again; the operator is on their way to the next step. */
  | "ready"
  /** Nothing restarted it, or it never came back. The operator finishes by hand. */
  | "stalled";

/** Why the wait ended without the app, kept as data so the words are chosen at render. */
type Detail =
  /** The restart route's own explanation, already translated on the server. */
  | { message: string }
  | { code: "refused"; status: number }
  | { code: "stillRunning" }
  | { code: "notBack" };

/** True when the app answered. A failure to connect is the expected reply while it is down. */
async function isUp(): Promise<boolean> {
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Whether the dashboard host is answering yet, asked of the app rather than of the browser.
 *
 * A cross-origin fetch from here could not read its own answer, and an opaque one cannot tell this
 * instance from whatever else holds the name. The server signs a nonce and checks it, which can.
 */
async function dashboardAnswers(): Promise<boolean> {
  try {
    const response = await fetch("/api/setup/dashboard-reachable", { cache: "no-store" });
    if (!response.ok) return false;
    const body = (await response.json()) as { ok?: unknown };
    return body.ok === true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function RestartDialog({
  next,
  restartToken,
  copy,
  preferredOrigin = null,
}: {
  /** Where to send the operator once the app is back, as a path. */
  next: string;
  /** Single-use proof that this browser ran the step, which the restart asks for. */
  restartToken: string;
  copy: RestartCopy;
  /**
   * An origin to prefer over this one - the dashboard host's, once setup has claimed it. Used only
   * if it actually answers: sending an operator to a domain whose DNS does not arrive here, or
   * whose Caddy is not running because no agent has paired, would end setup on a browser error.
   */
  preferredOrigin?: string | null;
}) {
  const t = useTranslations("setup");
  const [phase, setPhase] = useState<Phase>("stopping");
  // What went wrong, put into words at render rather than here: translating inside the effect
  // would make `t` one of its dependencies, and re-running it would cancel the restart in flight.
  const [detail, setDetail] = useState<Detail | null>(null);
  // Strict Mode mounts effects twice in development, and asking a process to exit twice is not
  // something to leave to chance.
  const started = useRef(false);

  const goOn = useCallback(
    (origin?: string) => {
      // A full load rather than a router push: the process serving this page is not the one that
      // will serve the next, and nothing client-side should be carried across.
      loadPage(origin ? `${origin}${next}` : next);
    },
    [next],
  );

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    let cancelled = false;

    void (async () => {
      const deadline = Date.now() + COOLDOWN_BUDGET_MS;
      // Loops only for a cooldown; every other answer leaves it on the first pass.
      for (;;) {
        try {
          const response = await fetch("/api/setup/restart", {
            method: "POST",
            headers: { "x-cpm-restart-token": restartToken },
          });
          if (response.status === 429 && Date.now() < deadline) {
            const after = Number(response.headers.get("retry-after"));
            if (cancelled) return;
            setPhase("queued");
            await sleep(Number.isFinite(after) && after > 0 ? after * 1000 : POLL_INTERVAL_MS);
            if (cancelled) return;
            setPhase("stopping");
            continue;
          }
          if (!response.ok && response.status !== 202) {
            const body = (await response.json().catch(() => null)) as { error?: string } | null;
            if (!cancelled) {
              setDetail(
                body?.error != null
                  ? { message: body.error }
                  : { code: "refused", status: response.status },
              );
              setPhase("stalled");
            }
            return;
          }
        } catch {
          // The connection dropping as the process exits is a normal outcome here, not a failure:
          // the request did its job on the way out. The polling below is what decides.
        }
        break;
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
        setDetail({ code: "stillRunning" });
        setPhase("stalled");
        return;
      }

      setPhase("starting");

      const startupBy = Date.now() + STARTUP_BUDGET_MS;
      while (!cancelled && Date.now() < startupBy) {
        if (await isUp()) {
          if (cancelled) return;
          setPhase("ready");

          // The app is back, so the operator is leaving either way; the only question left is by
          // which name. Caddy is configured as the app starts, so the route can be a moment behind
          // it - hence a short wait rather than a single ask.
          if (preferredOrigin) {
            const dashboardBy = Date.now() + DASHBOARD_BUDGET_MS;
            while (!cancelled && Date.now() < dashboardBy) {
              if (await dashboardAnswers()) {
                if (cancelled) return;
                goOn(preferredOrigin);
                return;
              }
              await sleep(POLL_INTERVAL_MS);
            }
            if (cancelled) return;
          }

          goOn();
          return;
        }
        await sleep(POLL_INTERVAL_MS);
      }
      if (cancelled) return;

      setDetail({ code: "notBack" });
      setPhase("stalled");
    })();

    return () => {
      cancelled = true;
    };
  }, [goOn, restartToken, preferredOrigin]);

  const waiting = phase !== "stalled";

  const detailText =
    detail === null
      ? null
      : "message" in detail
        ? detail.message
        : detail.code === "refused"
          ? t("restartRefused", { status: detail.status })
          : detail.code === "stillRunning"
            ? t("restartStillRunning")
            : t("restartNotBack");

  return (
    <Center>
      <VStack gap={2} padding={5}>
        <Heading level={1}>{copy.heading}</Heading>
        <Text color="secondary">{copy.lead}</Text>
      </VStack>

      <Dialog isOpen onOpenChange={() => {}} width={560} purpose="required">
        <Layout
          header={<DialogHeader title={copy.title} />}
          content={
            <LayoutContent>
              <VStack gap={4}>
                <Text size="sm" color="secondary">
                  {copy.description}
                </Text>

                {waiting ? (
                  <HStack gap={3} align="center">
                    <Spinner />
                    <Text size="sm">
                      {phase === "queued"
                        ? t("restartQueued")
                        : phase === "stopping"
                          ? t("restartStopping")
                          : phase === "starting"
                            ? t("restartWaiting")
                            : t("restartReady")}
                    </Text>
                  </HStack>
                ) : (
                  <VStack gap={3}>
                    <Banner
                      status="warning"
                      title={t("restartFailedTitle")}
                      description={detailText ? copy.manuallyWithDetail(detailText) : copy.manually}
                    />
                    <Text size="sm" color="secondary">
                      {t("composeRestartHelp")}
                    </Text>
                    <Code>docker compose --profile caddy restart web agent caddy</Code>
                  </VStack>
                )}

                <Text size="xsm" color="secondary">
                  {copy.note}
                </Text>
              </VStack>
            </LayoutContent>
          }
          footer={
            <LayoutFooter>
              <HStack gap={2} justify="end">
                <Button
                  variant={phase === "stalled" ? "primary" : "secondary"}
                  label={
                    phase === "stalled" ? t("restartContinue") : t("restartContinueWithoutWaiting")
                  }
                  onClick={() => goOn()}
                />
              </HStack>
            </LayoutFooter>
          }
        />
      </Dialog>
    </Center>
  );
}
