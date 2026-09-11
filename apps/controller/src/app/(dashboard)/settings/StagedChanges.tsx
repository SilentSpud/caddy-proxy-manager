"use client";

/**
 * The bar that says something is pending, and the sheet that applies it.
 *
 * Present on every settings screen rather than on the one being edited, because a change set spans
 * sections: an operator who edits DNS on one page and geo-blocking on another has one pending
 * apply, not two, and a bar that only appeared on the page they happened to be on would hide half
 * of it.
 */

import { useState, useTransition } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Divider } from "@astryxdesign/core/Divider";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { Banner } from "@astryxdesign/core/Banner";
import { Spinner } from "@astryxdesign/core/Spinner";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import type { DiffLine } from "@/src/lib/settings/config-diff";
import type { StagedView } from "@/src/lib/settings/staged-view";
import { applyStagedSettingsAction, discardStagedSettingsAction } from "./actions";

/**
 * Discard and Review & apply, for the settings header.
 *
 * Was a bar pinned to the foot of the page. It moved into the header because the apply control
 * should have one address: an operator who scrolls a long section must not have to hunt for it,
 * and a floating bar over the last form field was the thing it most often covered.
 */
export function StagedControls({ view }: { view: StagedView }) {
  const t = useTranslations("settings");
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (view.changes.length === 0) return null;

  const discardAll = () => {
    startTransition(async () => {
      await discardStagedSettingsAction();
      router.refresh();
    });
  };

  return (
    <HStack gap={2} vAlign="center" data-testid="staged-bar">
      <Button
        variant="ghost"
        size="sm"
        label={t("stagedDiscard")}
        onClick={discardAll}
        isDisabled={pending}
      />
      <Button
        size="sm"
        label={t("stagedReview")}
        endContent={<Badge variant="warning" label={String(view.changes.length)} />}
        onClick={() => setOpen(true)}
      />
      <ReviewSheet view={view} open={open} onClose={() => setOpen(false)} />
    </HStack>
  );
}

/** Which configuration Caddy is running, and whether the last apply got there. */
export function RevisionPill({ staged }: { staged: StagedView }) {
  const t = useTranslations("settings");
  if (staged.currentRevision === null) {
    return (
      <Text type="supporting" color="secondary">
        {t("revisionNever")}
      </Text>
    );
  }
  const latest = staged.revisions[0];
  return (
    <Badge
      variant={latest?.outcome === "failed" ? "error" : "success"}
      label={t("revisionPill", { id: staged.currentRevision })}
    />
  );
}

function ReviewSheet({
  view,
  open,
  onClose,
}: {
  view: StagedView;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("settings");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const apply = () => {
    setError(null);
    startTransition(async () => {
      const result = await applyStagedSettingsAction();
      if (!result.success) {
        setError(result.message ?? null);
        return;
      }
      onClose();
      router.refresh();
    });
  };

  const undo = (key: string) => {
    startTransition(async () => {
      await discardStagedSettingsAction(key);
      router.refresh();
    });
  };

  const next = view.currentRevision === null ? 1 : view.currentRevision + 1;

  return (
    <Dialog isOpen={open} onOpenChange={(isOpen) => !isOpen && onClose()} width={1000}>
      <DialogHeader title={t("reviewTitle")} onOpenChange={(isOpen) => !isOpen && onClose()} />
      <VStack gap={4} padding={4}>
        <Text type="supporting" color="secondary">
          {t("reviewSubtitle", { from: view.currentRevision ?? 0, to: next })}
        </Text>

        {error && <Banner status="error" title={error} />}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 360px) minmax(0, 1fr)",
            gap: "var(--spacing-4)",
            alignItems: "start",
          }}
        >
          <VStack gap={3}>
            <Heading level={3}>{t("reviewChangeCount", { count: view.changes.length })}</Heading>
            <Divider />
            {view.changes.map((change) => (
              <HStack key={change.key} gap={2} vAlign="start">
                <VStack gap={0} style={{ flexGrow: 1, minWidth: 0 }}>
                  <Text type="label">{change.label}</Text>
                  <Text type="supporting" color="secondary">
                    {change.key}
                  </Text>
                </VStack>
                <Button
                  variant="ghost"
                  size="sm"
                  label={t("reviewUndo")}
                  onClick={() => undo(change.key)}
                  isDisabled={pending}
                />
              </HStack>
            ))}

            {view.revisions.length > 0 && (
              <>
                <Divider />
                <Heading level={5}>{t("reviewHistoryTitle")}</Heading>
                {view.revisions.map((revision) => (
                  <HStack key={revision.id} gap={2} vAlign="center">
                    <Text type="code" size="xsm" color="secondary">
                      #{revision.id}
                    </Text>
                    <Text type="supporting" color="secondary" maxLines={1}>
                      {revision.summary}
                    </Text>
                    <div style={{ flexGrow: 1 }} />
                    {revision.outcome === "failed" && (
                      <Badge variant="error" label={t("revisionFailed")} />
                    )}
                  </HStack>
                ))}
              </>
            )}
          </VStack>

          <VStack gap={2}>
            <HStack gap={2} vAlign="center">
              <Heading level={3}>{t("reviewTabConfig")}</Heading>
              <div style={{ flexGrow: 1 }} />
              <Text type="supporting" color="secondary">
                {t("reviewDiffStat", { added: view.diff.added, removed: view.diff.removed })}
              </Text>
            </HStack>
            <Divider />
            {view.diff.unchanged ? (
              <Banner status="info" title={t("reviewNoConfigChange")} />
            ) : (
              <>
                <DiffView lines={view.diff.lines} />
                <Text type="supporting" color="secondary">
                  {t("reviewSecretsMasked")}
                </Text>
              </>
            )}
          </VStack>
        </div>

        <Divider />
        <HStack gap={2} justify="end" vAlign="center">
          {pending && <Spinner size="sm" />}
          <Button
            variant="secondary"
            label={t("reviewClose")}
            onClick={onClose}
            isDisabled={pending}
          />
          <Button
            label={pending ? t("reviewApplying") : t("reviewApply")}
            onClick={apply}
            isDisabled={pending}
          />
        </HStack>
      </VStack>
    </Dialog>
  );
}

/** Colours come from the status tokens rather than raw hex, so the diff follows the theme. */
const DIFF_BACKGROUND: Record<DiffLine["kind"], string | undefined> = {
  added: "var(--color-success-muted)",
  removed: "var(--color-error-muted)",
  context: undefined,
  gap: "var(--color-background-muted)",
};

function DiffView({ lines }: { lines: DiffLine[] }) {
  return (
    <div
      style={{
        maxHeight: 420,
        overflow: "auto",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-inner)",
        fontFamily: "var(--font-family-code)",
        fontSize: "var(--font-size-sm)",
        lineHeight: 1.7,
      }}
      data-testid="config-diff"
    >
      {lines.map((line, index) => (
        <div
          // A diff line has no identity beyond its position: the same text recurs, and the list is
          // replaced wholesale each render, so no state can follow a reorder to the wrong row.
          // biome-ignore lint/suspicious/noArrayIndexKey: position is the only identity a diff line has
          key={`${index}-${line.kind}`}
          style={{
            display: "flex",
            gap: "var(--spacing-2)",
            padding: "0 var(--spacing-2)",
            background: DIFF_BACKGROUND[line.kind],
            whiteSpace: "pre",
          }}
        >
          <span style={{ width: 44, flexShrink: 0, color: "var(--color-text-secondary)" }}>
            {line.line ?? ""}
          </span>
          <span
            style={{
              color:
                line.kind === "gap" ? "var(--color-text-secondary)" : "var(--color-text-primary)",
            }}
          >
            {line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " "}
            {line.kind === "gap" ? ` ${line.text} ` : line.text}
          </span>
        </div>
      ))}
    </div>
  );
}
