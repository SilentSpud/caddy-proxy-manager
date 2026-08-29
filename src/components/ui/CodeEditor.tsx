"use client";

/**
 * A Monaco-backed TextArea replacement for code fields. Monaco has no form-associated element, so
 * the value rides in a hidden input; a real TextArea renders until it loads, or forever if never.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "@astryxdesign/core";
import { TextArea } from "@astryxdesign/core/TextArea";
import { Text } from "@astryxdesign/core/Text";
import { VStack, HStack } from "@astryxdesign/core/Stack";
import { CADDYFILE_LANGUAGE_ID, type Monaco, loadMonaco } from "./monaco-setup";
// Type-only, so it is erased at build time and pulls none of Monaco into this chunk — see
// monaco-setup.ts for why that matters.
import type { editor } from "monaco-editor";

export type CodeEditorLanguage = "json" | "caddyfile" | "dockerfile" | "html" | "ini" | "plaintext";

/** Rows for the textarea fallback, chosen to roughly match the Monaco height. */
const HEIGHT_ROWS = { sm: 6, md: 12, lg: 20 } as const;
/** Tailwind height utilities — the editor host needs a fixed box to lay out in. */
const HEIGHT_CLASS = { sm: "h-40", md: "h-72", lg: "h-96" } as const;

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
  height?: keyof typeof HEIGHT_ROWS;
};

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
  const { mode } = useTheme();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const [ready, setReady] = useState(false);

  // The latest onChange without making it an effect dependency — a parent passing an inline
  // arrow (most do) would otherwise tear down and recreate the editor on every keystroke,
  // losing cursor and undo history.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Same idea for the incoming value: the create-effect needs the current text once, at mount.
  const valueRef = useRef(value);
  valueRef.current = value;

  // Monaco's theme is global to the module, so it is applied at creation and again whenever the
  // app theme changes. Read through a ref so the create-effect does not re-run — and rebuild the
  // editor — every time someone flips light/dark.
  const monacoTheme = mode === "dark" ? "vs-dark" : "vs";
  const monacoThemeRef = useRef(monacoTheme);
  monacoThemeRef.current = monacoTheme;

  const readOnly = Boolean(isReadOnly || isDisabled);

  useEffect(() => {
    let disposed = false;
    let created: editor.IStandaloneCodeEditor | null = null;

    void (async () => {
      const monaco = await loadMonaco();
      if (!monaco || disposed || !hostRef.current) return;

      monacoRef.current = monaco;
      created = monaco.editor.create(hostRef.current, {
        value: valueRef.current,
        language: language === "caddyfile" ? CADDYFILE_LANGUAGE_ID : language,
        automaticLayout: true,
        minimap: { enabled: false },
        // Config snippets are short; a scrollbar that appears only when needed reads better than
        // a permanently reserved gutter.
        scrollBeyondLastLine: false,
        lineNumbers: "on",
        renderLineHighlight: "none",
        fontSize: 13,
        tabSize: 2,
        wordWrap: "on",
        readOnly,
        theme: monacoThemeRef.current,
        // Monaco renders its own hidden textarea, which a screen reader otherwise announces as
        // the generic "Editor content". The visible label above is a styled Text node, not a
        // <label>, so this is the only thing naming the field once the TextArea fallback is gone.
        ariaLabel: label,
        // Without this the editor glues its own scroll position to the page scroll on long
        // settings pages, which feels broken.
        scrollbar: { alwaysConsumeMouseWheel: false },
      });

      created.onDidChangeModelContent(() => {
        const next = created?.getValue() ?? "";
        // Guard against echoing back the value we were just handed — otherwise a controlled
        // parent and the editor ping-pong on every render.
        if (next === valueRef.current) return;
        valueRef.current = next;
        onChangeRef.current?.(next);
      });

      editorRef.current = created;
      setReady(true);
    })();

    return () => {
      disposed = true;
      created?.getModel()?.dispose();
      created?.dispose();
      editorRef.current = null;
      setReady(false);
    };
  }, [language, readOnly, label]);

  // External value changes (a form reset, loading a different record) must reach the model, but
  // only when they genuinely differ — setValue moves the cursor to the end, so doing it on every
  // render would make typing unusable.
  useEffect(() => {
    const instance = editorRef.current;
    if (!instance) return;
    if (instance.getValue() === value) return;
    valueRef.current = value;
    instance.setValue(value);
  }, [value]);

  useEffect(() => {
    monacoRef.current?.editor.setTheme(monacoTheme);
  }, [monacoTheme]);

  const handleTextAreaChange = useCallback(
    (next: string) => {
      valueRef.current = next;
      onChange?.(next);
    },
    [onChange],
  );

  return (
    <VStack gap={2}>
      {/* The hidden input is the only thing the form ever reads, so it is
          rendered identically whether Monaco or the fallback is showing.
          Disabled fields submit nothing, matching native control behaviour. */}
      {htmlName && !isDisabled && <input type="hidden" name={htmlName} value={value} />}

      {ready ? (
        <VStack gap={1}>
          <HStack justify="between" align="center">
            <Text type="label" size="xsm" weight="semibold" color="secondary">
              {label}
            </Text>
            <Text type="body" size="xsm" color="secondary">
              {language === "caddyfile" ? "Caddyfile" : language.toUpperCase()}
            </Text>
          </HStack>
          {description && (
            <Text type="body" size="xsm" color="secondary">
              {description}
            </Text>
          )}
        </VStack>
      ) : (
        <TextArea
          label={label}
          description={description}
          placeholder={placeholder}
          value={value}
          onChange={handleTextAreaChange}
          rows={HEIGHT_ROWS[height]}
          isDisabled={isDisabled}
          isReadOnly={isReadOnly}
        />
      )}

      {/* Monaco measures and paints into a real element it owns, so it needs a
          plain host node with an explicit box — the same arrangement the
          analytics map uses for MapLibre. Kept mounted but zero-height until
          ready so the fallback and the editor never both take up space. */}
      <div className={ready ? "relative w-full" : "contents"}>
        <div
          ref={hostRef}
          className={
            ready
              ? `${HEIGHT_CLASS[height]} w-full overflow-hidden rounded-md border border-border`
              : "h-0 w-full overflow-hidden"
          }
        />
        {/* Monaco has no placeholder of its own, and the fallback TextArea that
            did show one is unmounted the moment Monaco is ready — taking the
            example away exactly when the field becomes usable. Overlaid rather
            than inserted as text so it never becomes part of the value.
            Offset clears Monaco's line-number gutter. */}
        {ready && placeholder && value === "" && (
          <div className="pointer-events-none absolute left-16 top-1 select-none whitespace-pre font-mono text-xs opacity-50">
            {placeholder}
          </div>
        )}
      </div>
    </VStack>
  );
}
