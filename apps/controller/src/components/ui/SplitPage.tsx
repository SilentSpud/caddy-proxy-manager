"use client";

/**
 * A list-detail page: a searchable rail of records on the left, the selected record on the right.
 *
 * The shape Access Lists introduced, shared so Users and Groups read the same way: the rail is
 * resizable with its width remembered per page, and on a phone there is room for only one of the
 * two, so the rail shows until a record is picked and the detail then offers the way back.
 */
import { type ReactNode, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { Layout, LayoutContent, LayoutPanel } from "@astryxdesign/core/Layout";
import { VStack } from "@astryxdesign/core/Stack";
import { useMediaQuery } from "@astryxdesign/core/hooks";
import { PanelResizeHandle, usePersistedPanelWidth } from "@/components/ui/PanelResizeHandle";

export function SplitPage({
  storageKey,
  railLabel,
  resizeLabel,
  backLabel,
  rail,
  detail,
  hasSelection,
  phoneExtras,
  children,
}: {
  /** Names the remembered rail width; unique per page. */
  storageKey: string;
  /** The rail's landmark name. */
  railLabel: string;
  /** The divider's accessible name. */
  resizeLabel: string;
  /** The phone's way back from a record to the list. */
  backLabel: string;
  /**
   * The rail. `open` is what a row calls after selecting its record: on a phone it swaps the rail
   * for the detail, on a desktop both are already showing and it does nothing.
   */
  rail: (open: () => void) => ReactNode;
  detail: ReactNode;
  /** Whether a record is selected - on a phone, the detail only shows while one is. */
  hasSelection: boolean;
  /** Shown with the phone's rail only, such as a floating create button. */
  phoneExtras?: ReactNode;
  /** Rendered in every layout: dialogs and other overlays. */
  children?: ReactNode;
}) {
  // Both hooks before any branch, so the hook order never changes with the width.
  const width = usePersistedPanelWidth(storageKey, {
    defaultWidth: 320,
    minWidth: 240,
    maxWidth: 560,
  });
  const isNarrow = useMediaQuery("(max-width: 767px)");
  const [detailOpen, setDetailOpen] = useState(false);

  if (isNarrow) {
    return (
      <>
        {detailOpen && hasSelection ? (
          <VStack gap={3} padding={4}>
            <div>
              <Button
                variant="ghost"
                size="sm"
                icon={<ArrowLeft />}
                label={backLabel}
                onClick={() => setDetailOpen(false)}
              />
            </div>
            {detail}
          </VStack>
        ) : (
          <>
            {rail(() => setDetailOpen(true))}
            {phoneExtras}
          </>
        )}
        {children}
      </>
    );
  }

  return (
    <>
      <Layout
        height="fill"
        start={
          <>
            {/* No hasDivider: the handle is the line, and both would paint it. */}
            <LayoutPanel width={width.width} role="navigation" label={railLabel}>
              {rail(() => {})}
            </LayoutPanel>
            <PanelResizeHandle label={resizeLabel} panel={width} />
          </>
        }
        content={<LayoutContent padding={6}>{detail}</LayoutContent>}
      />
      {children}
    </>
  );
}
