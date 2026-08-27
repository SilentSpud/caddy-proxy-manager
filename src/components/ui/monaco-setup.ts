/**
 * One-time Monaco bootstrap, reached only through dynamic imports.
 *
 * Monaco is roughly 3.5 MB of JavaScript — larger than the rest of this app's
 * client bundle put together. Every import of it below is therefore deferred
 * until an editor actually mounts, so pages that merely *contain* a code field
 * inside an unopened dialog never pay for it. A static `import * as monaco`
 * here would defeat that: the chunk would be pulled in with whichever page
 * imports CodeEditor, opened dialog or not.
 *
 * Loading Monaco from a CDN (the default for most React wrappers) is
 * deliberately avoided: this app is routinely deployed on isolated networks,
 * and an editor that silently degrades to nothing without internet access is
 * worse than one that is a little larger to ship.
 */

export type Monaco = typeof import("monaco-editor");

/** Plain string, safe to import statically — it pulls none of Monaco with it. */
export const CADDYFILE_LANGUAGE_ID = "caddyfile";

let monacoPromise: Promise<Monaco | null> | null = null;

/**
 * Caddyfile has no Monaco grammar upstream, so this is a deliberately small
 * Monarch tokenizer: comments, environment/request placeholders, matcher
 * names, strings, and directives at the start of a line. It is here to make
 * snippets readable, not to validate them — Caddy itself does that when the
 * config is adapted, and that is the only judgement that counts.
 */
function registerCaddyfile(m: Monaco): void {
  if (m.languages.getLanguages().some((lang) => lang.id === CADDYFILE_LANGUAGE_ID)) return;

  m.languages.register({ id: CADDYFILE_LANGUAGE_ID, extensions: [".caddyfile"] });
  m.languages.setLanguageConfiguration(CADDYFILE_LANGUAGE_ID, {
    comments: { lineComment: "#" },
    brackets: [
      ["{", "}"],
      ["[", "]"],
    ],
    autoClosingPairs: [
      { open: "{", close: "}" },
      { open: '"', close: '"' },
    ],
  });
  m.languages.setMonarchTokensProvider(CADDYFILE_LANGUAGE_ID, {
    defaultToken: "",
    tokenizer: {
      root: [
        [/#.*$/, "comment"],
        // {env.FOO}, {http.request.uri}, {args[0]} — the source of most
        // Caddyfile confusion, so they are coloured distinctly from strings.
        [/\{[^}\s]*\}/, "variable"],
        [/@[\w.-]+/, "type.identifier"],
        [/"(?:[^"\\]|\\.)*"/, "string"],
        [/`[^`]*`/, "string"],
        [/\b\d+(\.\d+)?(ms|s|m|h|d|kb|mb|gb)?\b/, "number"],
        [/^\s*[a-z_][\w.]*/, "keyword"],
        [/[{}]/, "delimiter.bracket"],
      ],
    },
  });
}

async function bootstrap(): Promise<Monaco | null> {
  try {
    // The worker specifiers are the short `monaco-editor/<path>` form rather
    // than the deep `monaco-editor/esm/vs/<path>` one. Monaco 0.56 added an
    // `exports` map to its package.json which maps `./*` onto `./esm/vs/*.js`,
    // so the deep paths no longer resolve at all — the bundler fails on them
    // rather than falling back, and the `esm/vs` prefix is now implicit.
    const [monaco, editorWorker, jsonWorker] = await Promise.all([
      import("monaco-editor"),
      import("monaco-editor/editor/editor.worker?worker"),
      import("monaco-editor/language/json/json.worker?worker"),
    ]);

    // Monaco reads this global when a language service needs a worker. Only the
    // two languages this app edits in anger are wired up; the rest fall back to
    // the generic editor worker, which is enough for tokenizing and folding.
    (
      window as unknown as { MonacoEnvironment: import("monaco-editor").Environment }
    ).MonacoEnvironment = {
      getWorker(_workerId: string, label: string) {
        return label === "json" ? new jsonWorker.default() : new editorWorker.default();
      },
    };

    registerCaddyfile(monaco);
    return monaco;
  } catch (error) {
    console.warn("Monaco editor failed to load; falling back to a plain text area.", error);
    return null;
  }
}

/**
 * Load Monaco, wiring up workers and the Caddyfile grammar exactly once.
 *
 * Returns null when Monaco cannot be initialised at all, which lets CodeEditor
 * stay on its plain-textarea fallback rather than rendering an empty box. A
 * settings field that cannot be edited is a much worse failure than one that
 * loses syntax highlighting. The promise is cached rather than the result, so
 * several editors mounting in the same tick share one download instead of
 * racing to register the language twice.
 */
export function loadMonaco(): Promise<Monaco | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  monacoPromise ??= bootstrap();
  return monacoPromise;
}
