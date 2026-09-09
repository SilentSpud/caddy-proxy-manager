/**
 * The Settings and setup screens look their labels up by setting name, and validation errors by
 * code - both at runtime, so TypeScript cannot check those keys against the catalog the way it
 * checks a literal `t("...")`. These do it instead: a setting added to the registry without a
 * message here fails the build rather than rendering its raw key to an operator.
 */
import { describe, expect, it } from 'bun:test';
import messages from '../../messages/en.json';
import { SETTING_DEFINITIONS, SETTING_GROUPS } from '@/src/lib/settings/registry';
import { settingMessageName } from '@/src/lib/settings/messages';

const registry = messages.settings.registry as Record<
  string,
  { label?: string; description?: string } | undefined
>;

describe('settings.registry messages', () => {
  it('covers every setting in the registry', () => {
    const missing = SETTING_DEFINITIONS.map((definition) =>
      settingMessageName(definition.key),
    ).filter((name) => !registry[name]?.label || !registry[name]?.description);
    expect(missing).toEqual([]);
  });

  it('has no entry for a setting that no longer exists', () => {
    const known = new Set(
      SETTING_DEFINITIONS.map((definition) => settingMessageName(definition.key)),
    );
    expect(Object.keys(registry).filter((name) => !known.has(name))).toEqual([]);
  });

  it('strips the config: prefix the registry stores keys under', () => {
    // next-intl reads a dot as nesting; a colon would sit inside a key name and never resolve.
    for (const definition of SETTING_DEFINITIONS) {
      expect(settingMessageName(definition.key)).not.toContain(':');
    }
  });
});

describe('settings.groups messages', () => {
  it('names every group the pages render', () => {
    const groups = messages.settings.groups as Record<string, string | undefined>;
    expect(SETTING_GROUPS.filter((group) => !groups[group])).toEqual([]);
  });
});

describe('settings.validation messages', () => {
  it('covers every code the registry can reject with', () => {
    // Mirrors SettingValidationCode. Kept as a literal so adding a code without a message fails.
    const codes = [
      'boolean',
      'tristate',
      'text',
      'tooLong',
      'controlCharacter',
      'pattern',
      'wholeNumber',
      'range',
      'unknown',
    ];
    const validation = messages.settings.validation as Record<string, string | undefined>;
    expect(codes.filter((code) => !validation[code])).toEqual([]);
  });
});
