/**
 * Plugins switched off because Caddy refused to load the WAF with them.
 *
 * The install-time checks read rules rather than compile them, so a plugin can pass them and still
 * be one Coraza will not build - and Coraza building the WAF is part of Caddy loading the config,
 * so one such plugin would stop every host's config from loading. A plugin found at fault is
 * recorded here and left out of the config until it changes or an operator retries it.
 *
 * A settings row rather than a column: it is written while a config apply is recovering, outside
 * any staged change set, and it concerns the running Caddy rather than the plugin as installed.
 */

import { getSetting, setSetting } from "../settings";
import { outsideStagingScope } from "../settings/staging-context";

const KEY = "crs_plugin_quarantine";

export type CrsPluginLoadFailure = {
  /** When Caddy refused it. */
  at: string;
  /** The release it was refused at; a different one is worth trying again. */
  version: string;
};

/** By installed plugin id. */
export type CrsPluginQuarantine = Record<number, CrsPluginLoadFailure>;

export async function getCrsPluginQuarantine(): Promise<CrsPluginQuarantine> {
  return (await outsideStagingScope(() => getSetting<CrsPluginQuarantine>(KEY))) ?? {};
}

export async function setCrsPluginQuarantine(quarantine: CrsPluginQuarantine): Promise<void> {
  await outsideStagingScope(() => setSetting(KEY, quarantine));
}

/** Lets a plugin load again: after an update, a config edit, an uninstall or a retry. */
export async function releaseCrsPlugin(id: number): Promise<boolean> {
  const quarantine = await getCrsPluginQuarantine();
  if (!(id in quarantine)) return false;
  delete quarantine[id];
  await setCrsPluginQuarantine(quarantine);
  return true;
}
