"use client";

/**
 * A code field: a real `<textarea>` with a syntax-highlighted layer painted underneath it.
 *
 * The textarea is transparent apart from its caret, and sits exactly on top of a `<pre>` rendering
 * the same text as coloured spans. So selection, undo, spellcheck-off, IME, form submission and
 * every keyboard convention are the browser's own — the only thing this component adds is colour,
 * line numbers and an indent key.
 *
 * The two layers agree because they share one box: identical font, padding and wrapping, computed
 * once in `textLayer` below. Change one and change the other, or the colours drift off the glyphs.
 *
 * Colours and tokens come from Astryx — `tokenize` for the languages it knows, the syntax tokens
 * for the palette, so a code field matches a `<CodeBlock>` rendered beside it.
 */

import {
  type CSSProperties,
  type KeyboardEvent,
  useId,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { Field } from "@astryxdesign/core/Field";
import { HStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { ensureHighlightStyles } from "@astryxdesign/core/CodeBlock";
import { useTranslations } from "next-intl";
import { LANGUAGE_LABELS, tokenizeCode, type CodeEditorLanguage } from "./code-syntax";

export type { CodeEditorLanguage };

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
};

/** One line of the highlighted layer: its number, then its text split at the token boundaries. */
function Line({
  text,
  tokens,
  number,
}: {
  text: string;
  tokens: { type: string; start: number; end: number }[];
  number: number;
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
          color: "var(--color-text-secondary)",
          userSelect: "none",
        }}
      >
        {number}
      </span>
      {parts.length > 0 ? parts : ZERO_WIDTH_SPACE}
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
}: CodeEditorProps) {
  const t = useTranslations("ui");
  const inputID = useId();
  const descriptionID = useId();

  // Injects the --color-syntax-* fallbacks and the .astryx-token-* classes the spans above use.
  // An insertion effect, as CodeBlock does it: the rules have to exist before anything lays out.
  useInsertionEffect(() => ensureHighlightStyles(), []);

  const readOnly = Boolean(isReadOnly || isDisabled);
  const lines = useMemo(() => value.split("\n"), [value]);
  const tokenLines = useMemo(() => tokenizeCode(value, language), [value, language]);

  /**
   * Where the caret has to end up once the indent below has been through the parent's state and
   * come back as a new `value`. Writing a textarea's value moves its caret to the end, so anything
   * that edits the text for the typist has to put it back — and only after React has committed,
   * which is why this is a layout effect and not a callback.
   */
  const pendingCaret = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const caret = pendingCaret.current;
    if (caret === null) return;
    pendingCaret.current = null;
    textareaRef.current?.setSelectionRange(caret, caret);
  });

  /**
   * Tab indents rather than moving focus, which is what anyone typing a config expects — Escape
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
      description={description}
      inputID={inputID}
      descriptionID={description ? descriptionID : undefined}
      isDisabled={isDisabled}
    >
      {/* The hidden input is the only thing the form ever reads. Disabled fields submit nothing,
          matching native control behaviour. */}
      {htmlName && !isDisabled && <input type="hidden" name={htmlName} value={value} />}

      <div
        style={{
          position: "relative",
          height: `${HEIGHTS[height]}px`,
          overflow: "auto",
          background: "var(--color-syntax-background)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-element)",
          opacity: isDisabled ? 0.6 : 1,
        }}
      >
        <div style={{ position: "relative", minHeight: "100%" }}>
          <pre
            aria-hidden="true"
            style={{ ...textLayer, color: "var(--color-text-primary)", pointerEvents: "none" }}
          >
            {/* The theme gives `code` its own font and a line-height of its own, which would put
                every line 2px out of step with the textarea. Take the <pre>'s instead. */}
            <code style={{ display: "block", font: "inherit", lineHeight: "inherit" }}>
              {value === "" && placeholder ? (
                <span style={{ display: "block", opacity: 0.5 }}>{placeholder}</span>
              ) : (
                lines.map((line, index) => (
                  <Line
                    // A line has no identity beyond its position: inserting one really does
                    // renumber every line after it, which is what an index key describes. Nothing
                    // here holds state for React to move to the wrong row.
                    // biome-ignore lint/suspicious/noArrayIndexKey: see above
                    key={index}
                    text={line}
                    tokens={tokenLines[index] ?? []}
                    number={index + 1}
                  />
                ))
              )}
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

      {/* The keyboard hint is what makes Tab-to-indent discoverable, so it says so in the open
          rather than only through `aria-keyshortcuts`. */}
      <HStack justify="between" gap={2}>
        <Text type="body" size="xsm" color="secondary">
          {readOnly ? "" : t("codeEditor.keyboardHint")}
        </Text>
        <Text type="body" size="xsm" color="secondary">
          {LANGUAGE_LABELS[language]}
        </Text>
      </HStack>
    </Field>
  );
}
