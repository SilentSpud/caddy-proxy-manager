/**
 * Syntax tokenizers for the config languages this app edits.
 *
 * Astryx's own tokenizer covers JSON and HTML. It does not know Caddyfile, SecLang or Dockerfile,
 * and there is no upstream grammar for the first two worth pulling in — so they are described here
 * as a short list of patterns, in the same shape `CodeBlock` accepts for a custom tokenizer.
 *
 * This is readability, not validation: Caddy's adapter and Coraza's parser are what decide whether
 * a snippet is correct, and they say so on save.
 */

import { flatTokensToLines, tokenize, type TokenLine } from "@astryxdesign/core/CodeBlock";

export type CodeEditorLanguage =
  | "json"
  | "caddyfile"
  | "dockerfile"
  | "html"
  | "seclang"
  | "plaintext";

/** What the language is called in the corner of the editor. */
export const LANGUAGE_LABELS: Record<CodeEditorLanguage, string> = {
  json: "JSON",
  caddyfile: "Caddyfile",
  dockerfile: "Dockerfile",
  html: "HTML",
  seclang: "SecLang",
  plaintext: "Text",
};

/**
 * A pattern and the token type it paints. Types are Astryx's — anything else renders unstyled.
 *
 * Rules are tried in order at each position and the first match wins, so the ones that swallow
 * other syntax (comments, strings) have to come first. Every group inside a pattern must be
 * non-capturing: the rules are compiled into one alternation and the group index is what identifies
 * which rule matched.
 */
type Rule = readonly [RegExp, string];

const CADDYFILE: readonly Rule[] = [
  [/#.*/, "comment"],
  [/"(?:[^"\\]|\\.)*"/, "string"],
  [/`[^`]*`/, "string"],
  // {env.FOO}, {http.request.uri}, {args[0]} — the source of most Caddyfile confusion, so they are
  // coloured apart from the strings they usually sit inside.
  [/\{[^}\s]*\}/, "variable"],
  [/@[\w.-]+/, "type"],
  [/\b\d+(?:\.\d+)?(?:ms|s|m|h|d|kb|mb|gb)?\b/, "number"],
  [/(?<=^[ \t]*)[a-z_][\w.]*/, "keyword"],
  [/[{}]/, "punctuation"],
];

const SECLANG: readonly Rule[] = [
  [/#.*/, "comment"],
  [/"(?:[^"\\]|\\.)*"/, "string"],
  [/'(?:[^'\\]|\\.)*'/, "string"],
  [/(?<=^[ \t]*)Sec[A-Za-z]+/, "keyword"],
  // @contains, @ipMatch, @rx — the operator is the part of a rule people scan for.
  [/@[A-Za-z]+/, "operator"],
  // REQUEST_URI, REQUEST_HEADERS:User-Agent, ARGS. Screaming case is how SecLang spells a variable.
  [/\b[A-Z][A-Z0-9_]{2,}(?::[\w.-]+)?\b/, "variable"],
  [/\b\d+\b/, "number"],
  [/[|,]/, "punctuation"],
];

const DOCKERFILE: readonly Rule[] = [
  [/#.*/, "comment"],
  [/"(?:[^"\\]|\\.)*"/, "string"],
  [
    /(?<=^[ \t]*)(?:FROM|RUN|CMD|LABEL|MAINTAINER|EXPOSE|ENV|ADD|COPY|ENTRYPOINT|VOLUME|USER|WORKDIR|ARG|ONBUILD|STOPSIGNAL|HEALTHCHECK|SHELL)\b/,
    "keyword",
  ],
  [/\$\{?[A-Za-z_]\w*\}?/, "variable"],
  [/\bas\b/, "operator"],
  [/\b\d+\b/, "number"],
];

type Compiled = { pattern: RegExp; types: string[] };

/** Case matters in two of the three: SecLang variables are screaming case, Caddyfile is lowercase. */
function compile(rules: readonly Rule[], flags = "gm"): Compiled {
  return {
    pattern: new RegExp(rules.map(([re]) => `(${re.source})`).join("|"), flags),
    types: rules.map(([, type]) => type),
  };
}

const COMPILED: Partial<Record<CodeEditorLanguage, Compiled>> = {
  caddyfile: compile(CADDYFILE),
  seclang: compile(SECLANG),
  dockerfile: compile(DOCKERFILE, "gmi"),
};

function scan(code: string, compiled: Compiled): { type: string; start: number; end: number }[] {
  const tokens: { type: string; start: number; end: number }[] = [];
  compiled.pattern.lastIndex = 0;

  let match = compiled.pattern.exec(code);
  while (match) {
    // Group n+1 is rule n; exactly one of them is defined on any match.
    const rule = match.findIndex((group, index) => index > 0 && group !== undefined) - 1;
    if (rule >= 0 && match[0]) {
      tokens.push({
        type: compiled.types[rule] as string,
        start: match.index,
        end: match.index + match[0].length,
      });
    }
    // A pattern that can match nothing would otherwise spin here forever.
    if (!match[0]) compiled.pattern.lastIndex += 1;
    match = compiled.pattern.exec(code);
  }

  return tokens;
}

/**
 * Tokens for one snippet, per line, with line-relative offsets — the shape Astryx's own
 * `CodeBlock` works in. Empty for plaintext, and for anything that fails to tokenize: a field
 * that renders as unhighlighted text is a far better outcome than one that throws.
 */
export function tokenizeCode(code: string, language: CodeEditorLanguage): TokenLine[] {
  if (language === "plaintext" || !code) return [];

  try {
    const compiled = COMPILED[language];
    return compiled ? flatTokensToLines(scan(code, compiled), code) : tokenize(code, language);
  } catch {
    return [];
  }
}
