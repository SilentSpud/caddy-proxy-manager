/**
 * The name an agent knows this controller by: the one it shows when asking an operator to confirm
 * a pairing, and the one it stores beside the pairing afterwards.
 *
 * The instance's Application name - what the sidebar and every page title already call it - so the
 * name on the agent's terminal is the one the operator sees in the browser they generated the code
 * in. It used to read a `branding_title` setting that nothing writes, which made every controller
 * introduce itself as the default.
 */
import { appName } from "../settings/registry";
import { getSetting } from "../settings/resolve";

export async function controllerDisplayName(): Promise<string> {
  const name = await getSetting(appName).catch(() => appName.default);
  return name.trim() || appName.default;
}
