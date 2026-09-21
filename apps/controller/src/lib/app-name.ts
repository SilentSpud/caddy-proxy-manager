/**
 * What this instance calls itself: the Application name setting, where a value stored by setup or
 * Settings wins over APP_NAME.
 *
 * The sidebar, the login card, every page title and the name an agent introduces this controller
 * by all read it here rather than from `config.appName`, which is the environment alone and is
 * fixed for the life of the process - a name saved in Settings would never reach any of them.
 *
 * The settings modules are imported lazily, as public-url.ts does: they read process.env on first
 * load, and a static import would freeze that before a test could set it. The resolved value is
 * cached for the process by the settings layer, so this is not a query per page.
 */
import { config } from "./config";

export async function getAppName(): Promise<string> {
  try {
    const [{ appName }, { getSetting }] = await Promise.all([
      import("./settings/registry"),
      import("./settings/resolve"),
    ]);
    const name = (await getSetting(appName)).trim();
    return name || config.appName;
  } catch {
    return config.appName;
  }
}
