"use client";

/**
 * The frame a settings page's blocks render in: the heading over each one, the list of them down
 * the side, and the one bar that saves whichever of them were edited.
 *
 * Each block is still its own form and its own server action - what the merge removed is the
 * button per card. Five Save buttons down one page made the page read as five pages stacked, and
 * the operator has to press Review and apply afterwards regardless, so the page now says how many
 * blocks are unsaved and saves them together.
 */

import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { EnvTokens } from "@/src/components/ui/EnvTokens";
import { type SettingsBlock, settingsBlockDescription, settingsBlockName } from "./sections";

/**
 * A form the page-level bar must not submit: it asks something first, or its button does more
 * than save. Set as an attribute on the `<form>` rather than tracked in React state, because the
 * bar finds its forms in the DOM - it never sees the components that drew them.
 */
export const SKIP_PAGE_SAVE = { "data-page-save": "off" } as const;

/** One block: its heading, the variables that configure it, and the form it came with. */
export function SettingsBlockShell({
  block,
  showHeading,
  children,
}: {
  block: SettingsBlock;
  /** False on a page of one block: the page's own title already names it. */
  showHeading: boolean;
  children: ReactNode;
}) {
  const t = useTranslations("settings");
  return (
    // The anchor a legacy link lands on, and what the side list scrolls to. scroll-margin keeps
    // the heading clear of the sticky header the frame draws above it.
    <VStack
      gap={3}
      id={block.id}
      // Also as a data attribute: the dirty tracker keys each form's baseline on the block it is
      // in, and an id is something the design system's own elements have too.
      data-settings-block={block.id}
      style={{ scrollMarginTop: "var(--spacing-5)" }}
    >
      {showHeading ? (
        <VStack gap={1}>
          <HStack gap={2} vAlign="center" wrap="wrap">
            <Heading level={2}>{settingsBlockName(t, block.id)}</Heading>
            <EnvTokens names={block.env} />
          </HStack>
          <Text type="body" size="sm" color="secondary">
            {settingsBlockDescription(t, block.id)}
          </Text>
        </VStack>
      ) : (
        <EnvTokens names={block.env} />
      )}
      {children}
    </VStack>
  );
}

/**
 * Scroll to, and focus, the control a `?field=` link names.
 *
 * The review sheet lists the fields inside a staged change, and each one links here. A settings
 * key is one blob for a whole block, so without this the closest a link could get is the block.
 * Named by its form field rather than by an id: the design system generates ids, and the name is
 * what the change was recorded under anyway.
 */
export function FocusField() {
  const params = useSearchParams();
  const field = params.get("field");

  useEffect(() => {
    if (!field) return;
    // A frame later: the blocks fill their fields on mount, and a control that is not there yet
    // cannot be focused.
    const frame = requestAnimationFrame(() => {
      const control = document.querySelector<HTMLElement>(`[name="${CSS.escape(field)}"]`);
      if (!control) return;
      control.scrollIntoView({ block: "center", behavior: "smooth" });
      control.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [field]);

  return null;
}

/** Where a block sits on the page, for the list beside it. */
export type PageAnchor = { id: string; label: string };

/**
 * The blocks of this page, down the side.
 *
 * Only from three blocks up: with two, the list names what is already on screen. Clicking one
 * marks it rather than watching the scroll position - a settings page is read by jumping to the
 * thing you came for, and an observer that argues with the jump is worse than no highlight.
 */
export function OnThisPage({ anchors }: { anchors: readonly PageAnchor[] }) {
  const t = useTranslations("settings");
  const [current, setCurrent] = useState<string | null>(null);

  return (
    <nav
      aria-label={t("onThisPage")}
      style={{ width: "176px", flexShrink: 0, position: "sticky", top: 0 }}
    >
      <VStack gap={1}>
        <Text type="label" size="sm" color="secondary">
          {t("onThisPage")}
        </Text>
        {anchors.map((anchor) => (
          <a
            key={anchor.id}
            href={`#${anchor.id}`}
            onClick={() => setCurrent(anchor.id)}
            style={{
              display: "block",
              padding: "var(--spacing-1) var(--spacing-2)",
              borderInlineStart: `2px solid ${
                current === anchor.id ? "var(--color-border-accent)" : "var(--color-border)"
              }`,
              color:
                current === anchor.id ? "var(--color-text-primary)" : "var(--color-text-secondary)",
              textDecoration: "none",
              fontSize: "var(--font-size-sm)",
            }}
          >
            {anchor.label}
          </a>
        ))}
      </VStack>
    </nav>
  );
}

/**
 * What identifies a form across re-renders: the block it belongs to, and its place in it.
 *
 * Not the element, because React can replace a form's DOM node while the page is open and a
 * baseline held against the old node is then lost - what replaced it holds the operator's edits,
 * so it reads as untouched and the save bar disappears with unsaved work still on screen.
 *
 * Not the fields it submits either: a form that reveals a field when a selector changes - the
 * default response growing a status and a body - would look like a different form the moment it
 * did, and lose its baseline exactly when there was something to save.
 *
 * The block a form sits in is marked for this, and is as stable as the page itself. A block with
 * more than one form tells them apart by their order within it.
 */
function formKey(form: HTMLFormElement): string {
  const block = form.closest("[data-settings-block]");
  if (!block) return "";
  const forms = [...block.querySelectorAll("form")];
  return `${block.getAttribute("data-settings-block")}#${forms.indexOf(form)}`;
}

/** The controls a form submits, by the value each holds right now. */
function controlValues(form: HTMLFormElement): Map<Element, string> {
  const values = new Map<Element, string>();
  for (const element of form.elements) {
    const control = element as HTMLInputElement;
    // React's own bookkeeping inputs, and anything nameless, are not settings.
    if (!control.name || control.name.startsWith("$ACTION")) continue;
    if (control.type === "file") {
      const file = control.files?.[0];
      values.set(control, file ? `${file.name}:${file.size}` : "");
    } else if (control.type === "checkbox" || control.type === "radio") {
      values.set(control, String(control.checked));
    } else {
      values.set(control, control.value ?? "");
    }
  }
  return values;
}

/** The same, keyed by field name, which is what survives a form being re-rendered. */
function valuesByName(form: HTMLFormElement): Map<string, string> {
  const values = new Map<string, string>();
  for (const [control, value] of controlValues(form)) {
    values.set((control as HTMLInputElement).name, value);
  }
  return values;
}

/**
 * The smallest thing around a control that holds its label: its field.
 *
 * What the pink border is set on, because the bordered element is the design system's business -
 * an input's own box, a checkbox's indicator - and marking the field lets one rule reach either.
 */
function fieldOf(control: Element, form: HTMLFormElement): Element | null {
  for (let node = control.parentElement; node && node !== form; node = node.parentElement) {
    if (node.querySelector("label")) return node;
  }
  return null;
}

/**
 * The labels that name a control.
 *
 * Usually the ones pointing at its id - all of them, because a field drawn by EnvLabelledField
 * has the visible label beside the control and the design system's own, hidden, inside it. A
 * switch or checkbox submits through a hidden input with no id of its own, so that one takes the
 * labels of the smallest thing around it that has any, which is its own field.
 */
function labelsFor(control: Element, form: HTMLFormElement): Element[] {
  const id = (control as HTMLInputElement).id;
  if (id) {
    const byId = [...form.querySelectorAll(`label[for="${CSS.escape(id)}"]`)];
    if (byId.length > 0) return byId;
  }
  for (let node = control.parentElement; node && node !== form; node = node.parentElement) {
    const labels = [...node.querySelectorAll("label")];
    if (labels.length > 0) return labels;
  }
  return [];
}

/**
 * Mark which labels and fields hold something unsaved: typed here and not saved, or saved into
 * the change set and not applied to Caddy yet.
 *
 * The label carries it because that is the part a reader scans down a page of settings, and the
 * field because that is where the control they would go and fix is; `globals.css` colours both.
 * Written to the DOM rather than held in React state: the labels belong to the design system's
 * inputs, which take a string, so there is no prop to pass this through - and the tracker is
 * already reading these same elements.
 *
 * Collected first and written after, because a control that submits through a nameless hidden
 * input borrows the labels of whatever encloses it, which can be a field another control already
 * claimed. Clearing as it went, a clean control like that wiped the mark its neighbour had just
 * earned.
 */
function markUnsaved(
  form: HTMLFormElement,
  baseline: Map<string, string>,
  staged: ReadonlySet<string>,
): void {
  const labels = new Set<Element>();
  const fields = new Set<Element>();
  for (const [control, value] of controlValues(form)) {
    const before = baseline.get((control as HTMLInputElement).name);
    // Two ways to be unsaved: typed and not saved yet, or saved into the change set and not
    // applied. The second is what a page shows on its first load, which the baseline cannot see -
    // the field already holds the staged value, so it matches itself.
    const unsaved =
      staged.has((control as HTMLInputElement).name) || (before !== undefined && before !== value);
    if (!unsaved) continue;
    for (const label of labelsFor(control, form)) labels.add(label);
    const field = fieldOf(control, form);
    if (field) fields.add(field);
  }

  for (const label of form.querySelectorAll("label")) {
    if (labels.has(label)) label.setAttribute("data-unsaved", "true");
    else label.removeAttribute("data-unsaved");
  }
  for (const field of form.querySelectorAll("[data-unsaved-field]")) {
    if (!fields.has(field)) field.removeAttribute("data-unsaved-field");
  }
  for (const field of fields) field.setAttribute("data-unsaved-field", "true");
}

/** What a form would submit right now, as one comparable string. A file counts by name and size. */
function serializeForm(form: HTMLFormElement): string {
  const entries: string[] = [];
  for (const [key, value] of new FormData(form)) {
    entries.push(`${key}=${typeof value === "string" ? value : `${value.name}:${value.size}`}`);
  }
  return entries.join("\n");
}

/**
 * The forms inside `container` that differ from what they held when the page loaded or last saved.
 *
 * The same comparison `useFormDirty` makes for a single form, for every form on the page at once:
 * by value, so typing a change and undoing it reads as clean, and on a frame after each event,
 * because a switch writes its hidden input from React state after the click that set it.
 */
function useDirtyForms(
  container: RefObject<HTMLElement | null>,
  staged: ReadonlySet<string>,
): {
  dirty: HTMLFormElement[];
  /** Take what the forms hold now as the saved state, and show the page as clean. */
  accept: () => void;
} {
  const [dirty, setDirty] = useState<HTMLFormElement[]>([]);
  // Set by the effect, called by the bar: the baselines live in the effect's closure.
  const accept = useRef(() => {});

  useEffect(() => {
    const root = container.current;
    if (!root) return;

    // Every form on the page: a form the bar may not submit still has fields worth marking.
    const forms = () => [...root.querySelectorAll("form")];
    // The ones the bar counts and submits. A form that asks something first keeps its own button.
    const saveable = () => forms().filter((form) => form.getAttribute("data-page-save") !== "off");
    // Keyed by what the form submits rather than by the element, so a form React re-creates is
    // still the same form and keeps the baseline the operator's edits are measured against.
    const baselines = new Map<string, string>();
    // The same baseline, per field, so a label can say whether its own field is the changed one.
    const fieldBaselines = new Map<string, Map<string, string>>();
    let frame = 0;

    const rebaseline = () => {
      for (const form of forms()) {
        const key = formKey(form);
        baselines.set(key, serializeForm(form));
        fieldBaselines.set(key, valuesByName(form));
        markUnsaved(form, valuesByName(form), staged);
      }
    };
    // A frame later, once the fields that fill themselves on mount have done so.
    const baselineFrame = requestAnimationFrame(() => {
      rebaseline();
      setDirty([]);
    });

    accept.current = () => {
      cancelAnimationFrame(frame);
      rebaseline();
      setDirty([]);
    };

    const check = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setDirty((previous) => {
          for (const form of forms()) {
            const key = formKey(form);
            // A form whose fields this has not seen before: one rendered after the first frame.
            // What it holds now is its baseline - nothing has edited it yet - and its staged
            // fields still need marking.
            let fields = fieldBaselines.get(key);
            if (!fields) {
              fields = valuesByName(form);
              fieldBaselines.set(key, fields);
              baselines.set(key, serializeForm(form));
            }
            markUnsaved(form, fields, staged);
          }
          const next = saveable().filter((form) => {
            const baseline = baselines.get(formKey(form));
            return baseline !== undefined && serializeForm(form) !== baseline;
          });
          // Same set, same array: a new one every frame would rerender the bar continuously.
          const same =
            next.length === previous.length && next.every((form, i) => form === previous[i]);
          return same ? previous : next;
        });
      });
    };

    const observer = new MutationObserver(check);
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["value", "checked"],
    });
    const events = ["input", "change", "click", "keyup"] as const;
    for (const type of events) root.addEventListener(type, check);
    // React resets a form once its action has run, so what it holds then is the saved state.
    root.addEventListener("reset", () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        rebaseline();
        setDirty([]);
      });
    });

    return () => {
      cancelAnimationFrame(baselineFrame);
      cancelAnimationFrame(frame);
      observer.disconnect();
      for (const type of events) root.removeEventListener(type, check);
    };
  }, [container, staged]);

  return { dirty, accept: () => accept.current() };
}

/**
 * The page's blocks, and the bar that saves the edited ones.
 *
 * Saving submits each dirty form in turn. They are separate server actions on purpose - one per
 * settings group, each validating its own shape - and `stagedSettingsAction` takes the update lock,
 * so the writes queue rather than race.
 */
export function PageSaveBar({
  stagedFields,
  children,
}: {
  /** Form fields carrying a saved but unapplied edit, so a fresh page can mark them too. */
  stagedFields: readonly string[];
  children: ReactNode;
}) {
  const t = useTranslations("settings");
  const container = useRef<HTMLDivElement>(null);
  // A stable set: the effect that marks the labels depends on it.
  const staged = useMemo(() => new Set(stagedFields), [stagedFields]);
  const { dirty, accept } = useDirtyForms(container, staged);

  const save = useCallback(() => {
    for (const form of dirty) form.requestSubmit();
    // Clean as soon as it is sent, rather than when the server answers: these fields are React
    // state, so React does not reset them after its action and nothing else says the values on
    // screen are now the stored ones. An action that fails says so in its own block's banner.
    accept();
  }, [dirty, accept]);

  return (
    <>
      <div ref={container}>{children}</div>
      {dirty.length > 0 && (
        // Sticky rather than fixed: the pane it sits in is what scrolls, and a fixed bar would
        // float over the rail and the header too.
        <div
          style={{
            position: "sticky",
            bottom: 0,
            display: "flex",
            justifyContent: "center",
            paddingTop: "var(--spacing-4)",
            pointerEvents: "none",
          }}
        >
          <div style={{ pointerEvents: "auto" }} data-testid="settings-page-save-bar">
            <Card padding={2}>
              <HStack gap={3} vAlign="center">
                <Text type="body" size="sm">
                  {t("pageUnsaved", { count: dirty.length })}
                </Text>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  // A reload, not a form reset: these fields are React state, and resetting the
                  // DOM would leave the inputs showing what the components still believe.
                  onClick={() => window.location.reload()}
                  label={t("pageDiscard")}
                />
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={save}
                  label={t("save")}
                  // The page has other Save buttons - a card that saves something which is not a
                  // setting, such as the favicon - so this one is addressable on its own.
                  data-testid="settings-page-save"
                />
              </HStack>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
