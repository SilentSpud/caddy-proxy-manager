import { describe, expect, it } from 'bun:test';
import { tokenizeCode, type CodeEditorLanguage } from '@/src/components/ui/code-syntax';

/**
 * The tokenizers behind the code fields. Colour is cosmetic, but two things here are not:
 *
 * - The offsets are what CodeEditor slices each line with. A token reaching past the end of its
 *   line, or overlapping the one before it, paints the highlight onto the wrong glyphs.
 * - The rules are one alternation and the first match wins, so a pattern that can match nothing
 *   would spin forever. The invariant tests below are what keep both honest.
 */

/** The type of the token starting at `needle` on that line, or undefined if none starts there. */
function typeAt(code: string, language: CodeEditorLanguage, line: number, needle: string) {
  const start = (code.split('\n')[line] ?? '').indexOf(needle);
  return (tokenizeCode(code, language)[line] ?? []).find((t) => t.start === start)?.type;
}

/** Every token on every line, flattened, for the "is anything highlighted at all" assertions. */
function allTokens(code: string, language: CodeEditorLanguage) {
  return tokenizeCode(code, language).flatMap((line) => line ?? []);
}

describe('Caddyfile', () => {
  const code = [
    '# a comment with a {placeholder} in it',
    'handle /status* {',
    '  respond "ok {not_a_placeholder}" 200',
    '  header @api Cache-Control "max-age=30s"',
    '}',
  ].join('\n');

  it('paints a leading directive as a keyword', () => {
    expect(typeAt(code, 'caddyfile', 1, 'handle')).toBe('keyword');
  });

  it('paints a matcher as a type', () => {
    expect(typeAt(code, 'caddyfile', 3, '@api')).toBe('type');
  });

  it('paints a placeholder as a variable', () => {
    expect(typeAt('respond {http.request.uri}', 'caddyfile', 0, '{http.request.uri}')).toBe(
      'variable',
    );
  });

  it('lets a comment swallow the rest of its line', () => {
    const [comment, ...rest] = tokenizeCode(code, 'caddyfile')[0] ?? [];
    expect(comment?.type).toBe('comment');
    expect(comment?.start).toBe(0);
    expect(rest).toHaveLength(0);
  });

  it('lets a string swallow a placeholder inside it', () => {
    expect(typeAt(code, 'caddyfile', 2, '"ok {not_a_placeholder}"')).toBe('string');
  });

  it('paints a duration as a number', () => {
    expect(typeAt('  interval 10s', 'caddyfile', 0, '10s')).toBe('number');
  });

  it('starts an indented directive on the glyph, not on the indentation', () => {
    // The line-anchored rules match their own indentation to avoid a lookbehind, so the scanner
    // has to move the token past it. Getting this wrong paints the whitespace and shifts every
    // following token on the line.
    const tokens = tokenizeCode(code, 'caddyfile')[2] ?? [];
    expect(tokens[0]).toMatchObject({ type: 'keyword', start: 2, end: 9 });
    expect((code.split('\n')[2] ?? '').slice(2, 9)).toBe('respond');
  });
});

describe('SecLang', () => {
  const code = [
    '# block a path',
    'SecRule REQUEST_URI "@beginsWith /admin" "id:9001,phase:1,deny,status:403"',
    'SecRule REQUEST_HEADERS:User-Agent \'@contains badbot\' "id:9002,deny"',
  ].join('\n');

  it('paints a directive as a keyword', () => {
    expect(typeAt(code, 'seclang', 1, 'SecRule')).toBe('keyword');
  });

  it('paints a variable in screaming case', () => {
    expect(typeAt(code, 'seclang', 1, 'REQUEST_URI')).toBe('variable');
    expect(typeAt(code, 'seclang', 2, 'REQUEST_HEADERS:User-Agent')).toBe('variable');
  });

  it('keeps the operator inside the string it belongs to', () => {
    // The operator only reads as one when it is not already part of a quoted argument, which is
    // where every real rule puts it - so the string wins and the whole argument is one token.
    expect(typeAt(code, 'seclang', 1, '"@beginsWith /admin"')).toBe('string');
    expect(typeAt(code, 'seclang', 2, "'@contains badbot'")).toBe('string');
  });

  it('paints a bare operator as an operator', () => {
    expect(typeAt('SecRule ARGS @rx foo', 'seclang', 0, '@rx')).toBe('operator');
  });
});

describe('Dockerfile', () => {
  // Dockerfile's own substitution syntax, which happens to look like a JS placeholder.
  // biome-ignore lint/suspicious/noTemplateCurlyInString: see above
  const buildArg = '${MODULE}';
  const code = ['# build', 'FROM caddy:2 AS builder', `run xcaddy build --with ${buildArg}`].join(
    '\n',
  );

  it('paints an instruction as a keyword, in either case', () => {
    expect(typeAt(code, 'dockerfile', 1, 'FROM')).toBe('keyword');
    expect(typeAt(code, 'dockerfile', 2, 'run')).toBe('keyword');
  });

  it('paints a build argument as a variable', () => {
    expect(typeAt(code, 'dockerfile', 2, buildArg)).toBe('variable');
  });

  it('paints the stage alias as an operator', () => {
    expect(typeAt(code, 'dockerfile', 1, 'AS')).toBe('operator');
  });
});

describe('languages Astryx tokenizes', () => {
  it('highlights JSON', () => {
    expect(allTokens('{"handler": "headers"}', 'json').length).toBeGreaterThan(0);
  });

  it('highlights HTML', () => {
    expect(allTokens('<h1>Service unavailable</h1>', 'html').length).toBeGreaterThan(0);
  });
});

describe('invariants the renderer depends on', () => {
  const samples: [CodeEditorLanguage, string][] = [
    ['caddyfile', '# c\nhandle /x* {\n  respond "a\\"b" 200\n}\n\n@m path /y'],
    ['seclang', 'SecRule REQUEST_URI "@rx ^/a" "id:1"\n\n# trailing comment'],
    ['dockerfile', 'FROM caddy:2 AS b\nRUN echo "hi" && echo 2\n'],
    ['json', '{\n  "a": [1, 2],\n  "b": "c"\n}'],
    ['html', '<p class="x">hi</p>\n<!-- note -->'],
  ];

  for (const [language, code] of samples) {
    it(`keeps ${language} tokens inside their own line and in order`, () => {
      const lines = code.split('\n');
      tokenizeCode(code, language).forEach((tokens, index) => {
        let previousEnd = 0;
        for (const token of tokens ?? []) {
          expect(token.start).toBeGreaterThanOrEqual(previousEnd);
          expect(token.end).toBeGreaterThan(token.start);
          expect(token.end).toBeLessThanOrEqual((lines[index] ?? '').length);
          previousEnd = token.end;
        }
      });
    });
  }

  it('returns nothing for plaintext and for an empty field', () => {
    expect(tokenizeCode('SecRule REQUEST_URI "@rx a"', 'plaintext')).toEqual([]);
    expect(tokenizeCode('', 'caddyfile')).toEqual([]);
  });

  it('terminates on input that matches nothing', () => {
    expect(() => tokenizeCode('     \n\t\t\n     ', 'caddyfile')).not.toThrow();
    expect(() => tokenizeCode('"unterminated\n{{{{{{', 'seclang')).not.toThrow();
  });
});
