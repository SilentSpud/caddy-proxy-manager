"use client";

/**
 * A code field: a real `<textarea>` with a syntax-highlighted layer painted underneath it.
 *
 * The textarea is transparent apart from its caret, and sits exactly on top of a `<pre>` rendering
 * the same text as coloured spans. So selection, undo, spellcheck-off, IME, form submission and
 * every keyboard convention are the browser's own - the only thing this component adds is colour,
 * line numbers and an indent key.
 *
 * The two layers agree because they share one box: identical font, padding and wrapping, computed
 * once in `textLayer` below. Change one and change the other, or the colours drift off the glyphs.
 *
 * Colours and tokens come from Astryx - `tokenize` for the languages it knows, the syntax tokens
 * for the palette, so a code field matches a `<CodeBlock>` rendered beside it.
 */

import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Field } from "@astryxdesign/core/Field";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { ensureHighlightStyles } from "@astryxdesign/core/CodeBlock";
import { useTranslations } from "next-intl";
import { LANGUAGE_LABELS, tokenizeCode, type CodeEditorLanguage } from "./code-syntax";

export type { CodeEditorLanguage };

/** A problem with one line, from a linter: marks its number and is listed under the editor. */
export type CodeEditorIssue = {
  /** 1-based. */
  line: number;
  severity: "error" | "warning";
  message: string;
};

/** Listed under the editor; past this the list says how many more rather than growing the form. */
const MAX_LISTED_ISSUES = 6;

/** Editor heights, matching the three sizes the forms ask for. */
const HEIGHTS = { sm: 160, md: 288, lg: 384 } as const;

const GUTTER = 44;
const PAD_X = 10;
const PAD_Y = 8;
const INDENT = "  ";
/** Gives an empty line a line box, so the highlighted layer keeps step with the textarea. */
const ZERO_WIDTH_SPACE = "​";

/**
 * Everything that decides where a glyph lands. Applied to the highlighted layer and the textarea
 * alike; `pre-wrap` plus `break-word` on both is what keeps a wrapped line wrapping in the same
 * place in each.
 */
const textLayer: CSSProperties = {
  margin: 0,
  border: 0,
  padding: `${PAD_Y}px ${PAD_X}px ${PAD_Y}px ${GUTTER}px`,
  fontFamily: "var(--font-family-code)",
  fontSize: "var(--font-size-sm)",
  lineHeight: 1.6,
  letterSpacing: "normal",
  whiteSpace: "pre-wrap",
  overflowWrap: "break-word",
  wordBreak: "normal",
  tabSize: 2,
};

export type CodeEditorProps = {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  /** Form field name. A hidden input carries the value under it. */
  htmlName?: string;
  language: CodeEditorLanguage;
  description?: string;
  placeholder?: string;
  isReadOnly?: boolean;
  isDisabled?: boolean;
  height?: keyof typeof HEIGHTS;
  /** For an editor whose name is already on screen; the label stays for screen readers. */
  isLabelHidden?: boolean;
  /** No border or rounding, for an editor filling a pane whose own dividers frame it. */
  isFlush?: boolean;
  /** Drops the keyboard hint and language line under the editor. */
  isFooterHidden?: boolean;
  /** Floats over the editor's bottom corner, clear of the scrollbar: a Save button, say. */
  overlay?: ReactNode;
  /** Marked in the gutter and listed under the editor, in line order. */
  issues?: readonly CodeEditorIssue[];
};

/**
 * The scroller's native scrollbar width, which differs by platform and is 0 where scrollbars
 * overlay. Floated content (the `overlay` prop) is kept that far in from the right edge.
 */
function useScrollbarWidth(scroller: RefObject<HTMLDivElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setWidth(el.offsetWidth - el.clientWidth);
    measure();
    // Without it the width is measured once; floated content then only risks sitting on a
    // scrollbar that appears later.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, [scroller]);
  return width;
}

/** One line of the highlighted layer: its number, then its text split at the token boundaries. */
function Line({
  text,
  tokens,
  number,
  isPlaceholder = false,
  marker,
}: {
  text: string;
  tokens: { type: string; start: number; end: number }[];
  number: number;
  /** Dims the text but not the number, so an empty field still shows where line 1 is. */
  isPlaceholder?: boolean;
  /** Colours the number; the list under the editor says why, in words. */
  marker?: CodeEditorIssue["severity"];
}) {
  const parts = [];
  let at = 0;

  for (const token of tokens) {
    // A tokenizer can return overlapping or out-of-order spans; skip rather than render nonsense.
    if (token.start < at || token.end > text.length) continue;
    if (token.start > at) parts.push(text.slice(at, token.start));
    parts.push(
      <span key={token.start} className={`astryx-token-${token.type}`}>
        {text.slice(token.start, token.end)}
      </span>,
    );
    at = token.end;
  }
  if (at < text.length) parts.push(text.slice(at));

  return (
    <span style={{ display: "block", position: "relative" }}>
      <span
        style={{
          position: "absolute",
          left: `${PAD_X - GUTTER}px`,
          width: `${GUTTER - PAD_X * 2}px`,
          textAlign: "right",
          color: marker ? `var(--color-${marker})` : "var(--color-text-secondary)",
          fontWeight: marker ? 700 : undefined,
          userSelect: "none",
        }}
      >
        {number}
      </span>
      {isPlaceholder ? (
        <span style={{ opacity: 0.5 }}>{text || ZERO_WIDTH_SPACE}</span>
      ) : parts.length > 0 ? (
        parts
      ) : (
        ZERO_WIDTH_SPACE
      )}
    </span>
  );
}

export function CodeEditor({
  label,
  value,
  onChange,
  htmlName,
  language,
  description,
  placeholder,
  isReadOnly,
  isDisabled,
  height = "md",
  isLabelHidden,
  isFlush,
  isFooterHidden,
  overlay,
  issues = [],
}: CodeEditorProps) {
  const t = useTranslations("ui");
  const inputID = useId();
  const descriptionID = useId();

  // Injects the --color-syntax-* fallbacks and the .astryx-token-* classes the spans above use.
  // An insertion effect, as CodeBlock does it: the rules have to exist before anything lays out.
  useInsertionEffect(() => ensureHighlightStyles(), []);

  const readOnly = Boolean(isReadOnly || isDisabled);
  // An empty field numbers its placeholder's lines too. Unnumbered, the gutter was only a wide
  // blank margin, which read as padding rather than as room for line numbers.
  const showsPlaceholder = value === "" && Boolean(placeholder);
  const lines = useMemo(
    () => (showsPlaceholder ? (placeholder ?? "") : value).split("\n"),
    [showsPlaceholder, placeholder, value],
  );
  const tokenLines = useMemo(() => tokenizeCode(value, language), [value, language]);
  /** The worst severity on each line: an error outranks a warning on the same line. */
  const markers = useMemo(() => {
    const byLine = new Map<number, CodeEditorIssue["severity"]>();
    for (const issue of issues) {
      if (byLine.get(issue.line) !== "error") byLine.set(issue.line, issue.severity);
    }
    return byLine;
  }, [issues]);

  /**
   * Where the caret has to end up once the indent below has been through the parent's state and
   * come back as a new `value`. Writing a textarea's value moves its caret to the end, so anything
   * that edits the text for the typist has to put it back - and only after React has committed,
   * which is why this is a layout effect and not a callback.
   */
  const pendingCaret = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const scrollbarWidth = useScrollbarWidth(scrollerRef);

  useLayoutEffect(() => {
    const caret = pendingCaret.current;
    if (caret === null) return;
    pendingCaret.current = null;
    textareaRef.current?.setSelectionRange(caret, caret);
  });

  /**
   * Tab indents rather than moving focus, which is what anyone typing a config expects - Escape
   * first, then Tab, leaves the field, so the form is still reachable from the keyboard alone.
   * `aria-keyshortcuts` and the hint under the label are what say so.
   */
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Tab" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    const { selectionStart, selectionEnd } = event.currentTarget;
    event.preventDefault();

    onChange?.(`${value.slice(0, selectionStart)}${INDENT}${value.slice(selectionEnd)}`);
    pendingCaret.current = selectionStart + INDENT.length;
  };

  return (
    <Field
      label={label}
      isLabelHidden={isLabelHidden}
      description={description}
      inputID={inputID}
      descriptionID={description ? descriptionID : undefined}
      isDisabled={isDisabled}
    >
      {/* The hidden input is the only thing the form ever reads. Disabled fields submit nothing,
          matching native control behaviour. */}
      {htmlName && !isDisabled && <input type="hidden" name={htmlName} value={value} />}

      {/* The frame holds the border and the focus ring; the scroller inside it moves the text, so
          its scrollbar cannot paint over the ring. */}
      <div
        className="cpm-code-editor"
        data-flush={isFlush ? "" : undefined}
        style={{
          position: "relative",
          height: `${HEIGHTS[height]}px`,
          background: "var(--color-syntax-background)",
          border: isFlush ? 0 : "1px solid var(--color-border)",
          borderRadius: isFlush ? 0 : "var(--radius-element)",
          overflow: "hidden",
          opacity: isDisabled ? 0.6 : 1,
          // Read by .cpm-code-editor-overlay to keep floated content off the scrollbar.
          ["--cpm-scrollbar-gutter" as string]: `${scrollbarWidth}px`,
        }}
      >
        <div
          ref={scrollerRef}
          className="cpm-code-editor-scroller"
          style={{ height: "100%", overflow: "auto" }}
        >
          <div style={{ position: "relative", minHeight: "100%" }}>
            {/* The gutter's separator, as tall as the content rather than the viewport so it scrolls
              with the numbers. Halfway between the numbers' right edge and the text. */}
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: 0,
                width: `${GUTTER - PAD_X / 2}px`,
                borderRight: "1px solid var(--color-border)",
                pointerEvents: "none",
              }}
            />
            <pre
              aria-hidden="true"
              // A page translator would otherwise rewrite the directives in place, and the reader
              // would copy a Caddyfile that no longer parses.
              translate="no"
              style={{ ...textLayer, color: "var(--color-text-primary)", pointerEvents: "none" }}
            >
              {/* The theme gives `code` its own font and a line-height of its own, which would put
                every line 2px out of step with the textarea. Take the <pre>'s instead. */}
              <code style={{ display: "block", font: "inherit", lineHeight: "inherit" }}>
                {lines.map((line, index) => (
                  <Line
                    // A line has no identity beyond its position: inserting one really does
                    // renumber every line after it, which is what an index key describes. Nothing
                    // here holds state for React to move to the wrong row.
                    // biome-ignore lint/suspicious/noArrayIndexKey: see above
                    key={index}
                    text={line}
                    tokens={showsPlaceholder ? [] : (tokenLines[index] ?? [])}
                    number={index + 1}
                    isPlaceholder={showsPlaceholder}
                    marker={showsPlaceholder ? undefined : markers.get(index + 1)}
                  />
                ))}
              </code>
            </pre>

            <textarea
              ref={textareaRef}
              id={inputID}
              aria-describedby={description ? descriptionID : undefined}
              // Only while Tab is actually being taken; a read-only field never takes it.
              aria-keyshortcuts={readOnly ? undefined : "Tab Escape"}
              value={value}
              onChange={(event) => onChange?.(event.target.value)}
              onKeyDown={readOnly ? undefined : handleKeyDown}
              readOnly={readOnly}
              disabled={isDisabled}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              // Grammarly and friends inject their own overlay into a textarea, which lands between
              // these two layers and pushes the text off its highlighting.
              data-gramm="false"
              style={{
                ...textLayer,
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                resize: "none",
                outline: "none",
                background: "transparent",
                // The glyphs the reader sees are the ones in the <pre> underneath; this layer
                // contributes the caret, the selection and the events.
                color: "transparent",
                caretColor: "var(--color-text-primary)",
                overflow: "hidden",
              }}
            />
          </div>
        </div>
        {overlay && <div className="cpm-code-editor-overlay">{overlay}</div>}
      </div>

      {issues.length > 0 && (
        <VStack gap={1} role="list" aria-label={t("codeEditor.issuesLabel")}>
          {issues.slice(0, MAX_LISTED_ISSUES).map((issue, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: two issues can share a line and a message
            <HStack key={index} gap={2} align="center" role="listitem">
              <StatusDot
                variant={issue.severity}
                label={t(
                  issue.severity === "error" ? "codeEditor.errorLabel" : "codeEditor.warningLabel",
                )}
              />
              <Text type="body" size="xsm">
                {t("codeEditor.issueAt", { line: String(issue.line), message: issue.message })}
              </Text>
            </HStack>
          ))}
          {issues.length > MAX_LISTED_ISSUES && (
            <Text type="body" size="xsm" color="secondary">
              {t("codeEditor.moreIssues", { count: issues.length - MAX_LISTED_ISSUES })}
            </Text>
          )}
        </VStack>
      )}

      {/* The keyboard hint is what makes Tab-to-indent discoverable, so it says so in the open
          rather than only through `aria-keyshortcuts`. */}
      {!isFooterHidden && (
        <HStack justify="between" gap={2}>
          <Text type="body" size="xsm" color="secondary">
            {readOnly ? "" : t("codeEditor.keyboardHint")}
          </Text>
          <Text type="body" size="xsm" color="secondary">
            {language === "plaintext" ? t("codeEditor.plaintextLabel") : LANGUAGE_LABELS[language]}
          </Text>
        </HStack>
      )}
    </Field>
  );
}
