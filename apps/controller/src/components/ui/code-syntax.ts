/**
 * Syntax tokenizers for the config languages this app edits.
 *
 * Astryx's own tokenizer covers JSON and HTML. It does not know Caddyfile, SecLang or Dockerfile,
 * and there is no upstream grammar for the first two worth pulling in - so they are described here
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
 * A pattern and the token type it paints. Types are Astryx's - anything else renders unstyled.
 *
 * Rules are tried in order at each position and the first match wins, so the ones that swallow
 * other syntax (comments, strings) have to come first. Every group inside a pattern must be
 * non-capturing: the rules are compiled into one alternation and the group index is what identifies
 * which rule matched.
 *
 * A rule that has to sit at the start of its line matches the indentation as well - `^[ \t]*…`
 * rather than a `(?<=^[ \t]*)` lookbehind, which is not supported in every engine and would throw
 * where the pattern is built rather than where it is used. Those rules are marked `indented`, and
 * the scanner moves the token past the whitespace so the highlight still starts on the first glyph.
 */
type Rule = readonly [RegExp, string] | readonly [RegExp, string, "indented"];

const CADDYFILE: readonly Rule[] = [
  [/#.*/, "comment"],
  [/"(?:[^"\\]|\\.)*"/, "string"],
  [/`[^`]*`/, "string"],
  // {env.FOO}, {http.request.uri}, {args[0]} - the source of most Caddyfile confusion, so they are
  // coloured apart from the strings they usually sit inside.
  [/\{[^}\s]*\}/, "variable"],
  [/@[\w.-]+/, "type"],
  [/\b\d+(?:\.\d+)?(?:ms|s|m|h|d|kb|mb|gb)?\b/, "number"],
  [/^[ \t]*[a-z_][\w.]*/, "keyword", "indented"],
  [/[{}]/, "punctuation"],
];

const SECLANG: readonly Rule[] = [
  [/#.*/, "comment"],
  [/"(?:[^"\\]|\\.)*"/, "string"],
  [/'(?:[^'\\]|\\.)*'/, "string"],
  [/^[ \t]*Sec[A-Za-z]+/, "keyword", "indented"],
  // @contains, @ipMatch, @rx - the operator is the part of a rule people scan for.
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
    /^[ \t]*(?:FROM|RUN|CMD|LABEL|MAINTAINER|EXPOSE|ENV|ADD|COPY|ENTRYPOINT|VOLUME|USER|WORKDIR|ARG|ONBUILD|STOPSIGNAL|HEALTHCHECK|SHELL)\b/,
    "keyword",
    "indented",
  ],
  [/\$\{?[A-Za-z_]\w*\}?/, "variable"],
  [/\bas\b/, "operator"],
  [/\b\d+\b/, "number"],
];

type Compiled = { pattern: RegExp; types: string[]; indented: boolean[] };

/** Case matters in two of the three: SecLang variables are screaming case, Caddyfile is lowercase. */
function compile(rules: readonly Rule[], flags: string): Compiled {
  return {
    pattern: new RegExp(rules.map(([re]) => `(${re.source})`).join("|"), flags),
    types: rules.map(([, type]) => type),
    indented: rules.map(([, , indented]) => indented === "indented"),
  };
}

const SOURCES: Partial<Record<CodeEditorLanguage, [readonly Rule[], string]>> = {
  caddyfile: [CADDYFILE, "gm"],
  seclang: [SECLANG, "gm"],
  dockerfile: [DOCKERFILE, "gmi"],
};

/**
 * Compiled on first use rather than at module scope. A `RegExp` this file cannot build would
 * otherwise throw while the module was being imported, which no caller can catch and which would
 * take the whole editor down rather than only its colour - `tokenizeCode` catches it here instead.
 */
const cache = new Map<CodeEditorLanguage, Compiled>();

function compiledFor(language: CodeEditorLanguage): Compiled | undefined {
  const cached = cache.get(language);
  if (cached) return cached;

  const source = SOURCES[language];
  if (!source) return undefined;

  const compiled = compile(source[0], source[1]);
  cache.set(language, compiled);
  return compiled;
}

/** How much of a match is the indentation a line-anchored rule had to swallow to anchor itself. */
function indentLength(text: string): number {
  let length = 0;
  while (text[length] === " " || text[length] === "\t") length += 1;
  return length;
}

function scan(code: string, compiled: Compiled): { type: string; start: number; end: number }[] {
  const tokens: { type: string; start: number; end: number }[] = [];
  compiled.pattern.lastIndex = 0;

  let match = compiled.pattern.exec(code);
  while (match) {
    // Group n+1 is rule n; exactly one of them is defined on any match.
    const rule = match.findIndex((group, index) => index > 0 && group !== undefined) - 1;
    if (rule >= 0 && match[0]) {
      // A line-anchored rule matched from the line start, so the token begins after the indent.
      // The renderer slices each line by these offsets and would otherwise paint the whitespace
      // and shift every following token on the line.
      const offset = compiled.indented[rule] ? indentLength(match[0]) : 0;
      tokens.push({
        type: compiled.types[rule] as string,
        start: match.index + offset,
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
 * Tokens for one snippet, per line, with line-relative offsets - the shape Astryx's own
 * `CodeBlock` works in. Empty for plaintext, and for anything that fails to tokenize: a field
 * that renders as unhighlighted text is a far better outcome than one that throws.
 */
export function tokenizeCode(code: string, language: CodeEditorLanguage): TokenLine[] {
  if (language === "plaintext" || !code) return [];

  try {
    const compiled = compiledFor(language);
    return compiled ? flatTokensToLines(scan(code, compiled), code) : tokenize(code, language);
  } catch {
    return [];
  }
}
