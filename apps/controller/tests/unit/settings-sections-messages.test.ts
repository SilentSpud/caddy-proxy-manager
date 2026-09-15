/**
 * The settings rail, header and search render each section's name and description, and each
 * group's label, from the catalog by id - at runtime, so TypeScript cannot check those keys the way
 * it checks a literal `t("...")`. These do it instead: a section added to `sections.ts` without a
 * message fails the build rather than rendering its raw key, and the English entries must read
 * exactly as the module does, since e2e finds the rail's links by that text.
 */
import { describe, expect, it } from 'bun:test';
import { createTranslator } from 'next-intl';
import messages from '../../messages/en.json';
import {
  SETTINGS_GROUPS,
  SETTINGS_ITEMS,
  sectionMessageName,
  settingsGroupLabel,
  settingsSectionDescription,
  settingsSectionName,
} from '@/src/app/(dashboard)/settings/sections';

const t = createTranslator({ locale: 'en', messages, namespace: 'settings' });

describe('settings.sections messages', () => {
  it('names and describes every section as sections.ts does', () => {
    const mismatches = SETTINGS_ITEMS.flatMap((item) => [
      ...(settingsSectionName(t, item) === item.name ? [] : [`${item.id}.name`]),
      ...(settingsSectionDescription(t, item) === item.desc ? [] : [`${item.id}.desc`]),
    ]);
    expect(mismatches).toEqual([]);
  });

  it('has no entry for a section that no longer exists', () => {
    const known = new Set(SETTINGS_ITEMS.map((item) => sectionMessageName(item.id)));
    expect(Object.keys(messages.settings.sections).filter((name) => !known.has(name))).toEqual([]);
  });
});

describe('settings.navGroups messages', () => {
  it('labels every group as sections.ts does', () => {
    const mismatches = SETTINGS_GROUPS.filter(
      (group) => settingsGroupLabel(t, group) !== group.label,
    ).map((group) => group.id);
    expect(mismatches).toEqual([]);
  });

  it('has no entry for a group that no longer exists', () => {
    const known = new Set(SETTINGS_GROUPS.map((group) => sectionMessageName(group.id)));
    expect(Object.keys(messages.settings.navGroups).filter((name) => !known.has(name))).toEqual([]);
  });
});
