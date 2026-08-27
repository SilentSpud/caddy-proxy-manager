/**
 * Module gating must never remove a value from a form submission.
 *
 * The form actions in this app read an absent field as "empty", not as
 * "unchanged" — `parseWafConfig` turns a missing `wafExcludedRuleIds` into `[]`,
 * `parseGeoBlockConfig` turns every missing rule input into `[]`, and
 * `updateWafSettingsAction` turns a missing `wafCustomDirectives` into `""`.
 * Meanwhile the `wafPresent` / `geoblockPresent` markers submit unconditionally,
 * so the parser always runs and always writes.
 *
 * That combination makes greying-out dangerous in a way greying-out normally is
 * not: unmounting a rule editor — or disabling a field, since disabled controls
 * submit nothing — silently erases the stored value the next time the operator
 * saves an unrelated field on the same form. Rules an operator spent real effort
 * tuning (WAF false-positive suppressions, geo allow-lists) disappear with no
 * diff, no warning, and no way back short of a database restore.
 *
 * So module gating locks the *enable* switch and explains itself, and leaves
 * every value-carrying input mounted and submitting. These tests inspect source
 * rather than rendering, matching the convention in l4-ports-apply-banner.test.ts.
 */
import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(resolve(moduleDir, '../..', relative), 'utf-8');

const geoBlockFields = read('src/components/proxy-hosts/GeoBlockFields.tsx');
const wafFields = read('src/components/proxy-hosts/WafFields.tsx');
const wafEventsClient = read('app/(dashboard)/waf/WafEventsClient.tsx');
const proxyHostActions = read('app/(dashboard)/proxy-hosts/actions.ts');
const settingsActions = read('app/(dashboard)/settings/actions.ts');

describe('the parsers these components feed', () => {
  it('always runs once the presence marker is submitted', () => {
    // This is what makes the rest of the file matter: the parser cannot tell
    // "the operator cleared the rules" from "the inputs were not rendered".
    expect(proxyHostActions).toContain('if (!formData.has("geoblockPresent"))');
    expect(proxyHostActions).toContain('if (!formData.has("wafPresent")) return {};');
  });

  it('reads a missing rule list as empty rather than as unchanged', () => {
    expect(proxyHostActions).toMatch(/const rawExcl = formData\.get\("wafExcludedRuleIds"\)/);
    expect(proxyHostActions).toMatch(/excluded_rule_ids: number\[\] = rawExcl[\s\S]{0,200}: \[\];/);
  });
});

describe('GeoBlockFields', () => {
  it('submits the presence marker unconditionally', () => {
    expect(geoBlockFields).toContain('name="geoblockPresent"');
  });

  it('does not unmount the rule editors when the module is disabled', () => {
    // The rules panel guard must depend on the operator's own enable switch
    // only. Adding `&& !moduleDisabledReason` here erases every stored rule on
    // the next save.
    expect(geoBlockFields).not.toMatch(/\{enabled && !moduleDisabledReason && \(/);
    expect(geoBlockFields).toMatch(/\{enabled && \(/);
  });

  it('still locks the enable switch and says why', () => {
    // Gating has to remain visible — this is the half that is safe to do.
    expect(geoBlockFields).toMatch(/isDisabled=\{Boolean\(moduleDisabledReason\)\}/);
    expect(geoBlockFields).toContain('<ModuleGated feature="geoblock">');
  });
});

describe('WafFields', () => {
  it('submits the presence marker unconditionally', () => {
    expect(wafFields).toContain('name="wafPresent"');
  });

  it('does not unmount WafRuleExclusions when the module is disabled', () => {
    // WafRuleExclusions carries the hidden wafExcludedRuleIds input; losing it
    // wipes the host's suppression list.
    expect(wafFields).not.toMatch(/\{enabled && !moduleDisabledReason && \(/);
    expect(wafFields).toContain('<WafRuleExclusions');
  });

  it('still locks the enable switch and says why', () => {
    expect(wafFields).toMatch(/isDisabled=\{Boolean\(moduleDisabledReason\)\}/);
    expect(wafFields).toContain('<ModuleGated feature="waf">');
  });
});

describe('global WAF settings form', () => {
  it('reads a missing directives field as an empty string', () => {
    // Which is why the editor below must keep submitting even when gated.
    expect(settingsActions).toMatch(
      /const customDirectives =[\s\S]{0,200}formData\.get\("wafCustomDirectives"\)[\s\S]{0,120}: "";/,
    );
  });

  it('gates the directives editor read-only, never disabled', () => {
    // CodeEditor drops its hidden input when isDisabled, matching native form
    // behaviour — correct in general, fatal for a field whose absence means
    // "empty". isReadOnly blocks editing and still submits.
    const editorBlock = wafEventsClient.slice(
      wafEventsClient.indexOf('htmlName="wafCustomDirectives"'),
    );
    const props = editorBlock.slice(0, editorBlock.indexOf('/>'));
    expect(props).toContain('isReadOnly={Boolean(wafModuleDisabledReason)}');
    expect(props).not.toContain('isDisabled=');
  });
});

describe('CodeEditor form contract', () => {
  it('omits its hidden input only when disabled, never when read-only', () => {
    // The rule the call sites above depend on. If this changes, isReadOnly
    // stops being the safe choice and every gated editor needs revisiting.
    const codeEditor = read('src/components/ui/CodeEditor.tsx');
    expect(codeEditor).toContain('{htmlName && !isDisabled && <input type="hidden"');
  });
});
