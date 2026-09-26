/**
 * The setup demo's settings list against the registry it copies.
 *
 * `SETTING_FIELDS` is repeated by hand because the registry cannot be bundled for a browser, so
 * nothing else notices when a setting is added, renamed or given a new default - the demo just
 * keeps showing the old form. Bun can import the registry, so this holds the two together.
 */
import { expect, test } from "bun:test";
import { baseUrl, SETTING_DEFINITIONS } from "@cpm/controller/src/lib/settings/registry";
import { SETTING_FIELDS } from "../../src/demos/setup-simulation";

/** What app/setup/settings/page.tsx derives from a definition, minus the translated text. */
function expected(definition: (typeof SETTING_DEFINITIONS)[number]) {
  return {
    key: definition.key,
    env: definition.env,
    group: definition.group,
    kind:
      typeof definition.default === "boolean"
        ? "boolean"
        : typeof definition.default === "number"
          ? "number"
          : definition.default === null
            ? "tristate"
            : "string",
    secret: definition.secret === true,
    generatable: definition.generatable === true,
    gate: definition.gate === true,
    composeReads: definition.composeReads === true,
  };
}

function actual(field: (typeof SETTING_FIELDS)[number]) {
  return {
    key: field.key,
    env: field.env,
    group: field.group,
    kind: field.kind,
    secret: field.secret === true,
    generatable: field.generatable === true,
    gate: field.gate === true,
    composeReads: field.composeReads === true,
  };
}

test("the demo lists every registry setting, in order, with the same shape", () => {
  expect(SETTING_FIELDS.map(actual)).toEqual(SETTING_DEFINITIONS.map(expected));
});

test("the demo opens each field on the value the settings step would", () => {
  const values = SETTING_FIELDS.map((field) => [field.key, field.value]);
  const defaults = SETTING_DEFINITIONS.map((definition) => [
    definition.key,
    // A gate arrives as the answer the app acts on (off, on a fresh install), a secret as blank,
    // and the public URL as the address the page was reached at rather than the loopback default.
    definition.gate
      ? false
      : definition.secret
        ? ""
        : definition.key === baseUrl.key
          ? "http://cpm.lan:3000"
          : definition.default,
  ]);
  expect(values).toEqual(defaults);
});
