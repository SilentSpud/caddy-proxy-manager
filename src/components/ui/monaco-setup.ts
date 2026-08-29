/**
 * One-time Monaco bootstrap, reached only through dynamic imports: Monaco is ~3.5 MB, so every
 * import below is deferred until an editor mounts. Not loaded from a CDN — this app is routinely
 * deployed on isolated networks.
 */

export type Monaco = typeof import("monaco-editor");

/** Plain string, safe to import statically — it pulls none of Monaco with it. */
export const CADDYFILE_LANGUAGE_ID = "caddyfile";

let monacoPromise: Promise<Monaco | null> | null = null;

/**
 * A small Monarch tokenizer for Caddyfile, which has no upstream grammar: comments, placeholders,
 * matchers, strings and leading directives. Readability only — Caddy validates at adapt time.
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
    // The worker specifiers use the short `monaco-editor/<path>` form rather than the deep
    // `monaco-editor/esm/vs/<path>` one. Monaco 0.56 added an `exports` map mapping `./*` onto
    // `./esm/vs/*.js`, so the deep paths no longer resolve at all — the bundler fails on them
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
 * Load Monaco, wiring workers and the Caddyfile grammar exactly once. Null when it cannot
 * initialise, so CodeEditor keeps its textarea fallback. The promise is cached, not the result, so
 * editors mounting in one tick share a download instead of racing to register the language.
 */
export function loadMonaco(): Promise<Monaco | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  monacoPromise ??= bootstrap();
  return monacoPromise;
}
