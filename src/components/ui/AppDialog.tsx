"use client";

import type { ReactNode } from "react";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { HStack } from "@astryxdesign/core/Stack";
import { Button } from "@astryxdesign/core/Button";

type AppDialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  maxWidth?: "xs" | "sm" | "md" | "lg" | "xl";
  actions?: ReactNode;
  submitLabel?: string;
  onSubmit?: () => void;
  isSubmitting?: boolean;
  /** Gates the submit button on form validity, independent of isSubmitting. */
  isSubmitDisabled?: boolean;
};

/** Token-backed widths, replacing the max-w-* utility classes. */
const DIALOG_WIDTH: Record<NonNullable<AppDialogProps["maxWidth"]>, number> = {
  xs: 320,
  sm: 420,
  md: 560,
  lg: 720,
  xl: 960,
};

export function AppDialog({
  open,
  onClose,
  title,
  children,
  maxWidth = "sm",
  actions,
  submitLabel = "Save",
  onSubmit,
  isSubmitting = false,
  isSubmitDisabled = false,
}: AppDialogProps) {
  return (
    <Dialog
      isOpen={open}
      onOpenChange={(isOpen) => !isOpen && onClose()}
      width={DIALOG_WIDTH[maxWidth]}
      // "form" keeps a backdrop click from discarding half-entered input.
      purpose="form"
    >
      <Layout
        header={<DialogHeader title={title} onOpenChange={() => onClose()} />}
        content={<LayoutContent>{children}</LayoutContent>}
        footer={
          <LayoutFooter>
            <HStack gap={2} justify="end">
              {actions ?? (
                <>
                  <Button variant="secondary" label="Cancel" onClick={onClose} />
                  {onSubmit && (
                    <Button
                      label={submitLabel}
                      onClick={onSubmit}
                      isLoading={isSubmitting}
                      isDisabled={isSubmitting || isSubmitDisabled}
                    />
                  )}
                </>
              )}
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}
