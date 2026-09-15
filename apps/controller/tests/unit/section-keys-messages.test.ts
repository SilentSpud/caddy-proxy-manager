/**
 * The review sheet labels a staged change from the catalog by section id - at runtime, so
 * TypeScript cannot check the key the way it checks a literal `t("...")`. These do it instead: a
 * section added to `section-keys.ts` without a message fails here rather than rendering its raw key,
 * and the English must read exactly as the module's own label.
 */
import { describe, expect, it } from 'bun:test';
import { createTranslator } from 'next-intl';
import messages from '../../messages/en.json';
import {
  SECTION_STORAGE_KEYS,
  stagedChangeLabel,
  stagedLabelMessageName,
} from '@/src/lib/settings/section-keys';

const t = createTranslator({ locale: 'en', messages, namespace: 'settings' });

describe('settings.stagedLabels messages', () => {
  it('labels every section as section-keys.ts does', () => {
    const mismatches = Object.entries(SECTION_STORAGE_KEYS)
      .filter(([id, entry]) => stagedChangeLabel(t, { sectionId: id, label: '' }) !== entry.label)
      .map(([id]) => id);
    expect(mismatches).toEqual([]);
  });

  it('has no entry for a section that no longer exists', () => {
    const known = new Set(Object.keys(SECTION_STORAGE_KEYS).map(stagedLabelMessageName));
    expect(Object.keys(messages.settings.stagedLabels).filter((name) => !known.has(name))).toEqual(
      [],
    );
  });

  it('keeps the staged name of a key no section claims', () => {
    expect(stagedChangeLabel(t, { sectionId: null, label: 'mystery_key' })).toBe('mystery_key');
  });
});
