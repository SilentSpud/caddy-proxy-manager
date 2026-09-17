import type { NextRequest } from "next/server";
import { getTranslations } from "next-intl/server";
import { auth, checkSameOrigin } from "@/src/lib/auth";
import { createOAuthProvider, listOAuthProviders } from "@/src/lib/models/oauth-providers";
import { isAppRole } from "@/src/lib/oidc-groups";
import {
  analyticsEnabled,
  clickhousePassword,
  SETTING_DEFINITIONS,
  SettingValidationError,
} from "@/src/lib/settings/registry";
import { propagateOptionalFeatureSettings } from "@/src/lib/settings/optional-features";
import { resolveAllSettings, saveSettings } from "@/src/lib/settings/resolve";
import {
  type GeneralSettings,
  getDashboardSettings,
  saveDashboardSettings,
  saveGeneralSettings,
} from "@/src/lib/settings";
import { activateDashboardHost, dashboardHostOrigin, isHostname } from "@/src/lib/dashboard-host";
import { dashboardSettingsFromHost } from "@/src/lib/dashboard-host-options";
import { updateProxyHost } from "@/src/lib/models/proxy-hosts";
// SettingsValidationError, not the registry's SettingValidationError beside it: one belongs to the
// JSON groups and one to the registry, and this route now saves through both.
import { SettingsValidationError, validateSettingsGroup } from "@/src/lib/settings-validation";
import { isEmailAddress } from "@/src/lib/email-address";
import {
  getMigrationSource,
  isSetupCompleted,
  issueRestartToken,
  markSetupCompleted,
  promoteFirstSetupAdmin,
} from "@/src/lib/setup";

/**
 * POST /api/setup/complete - save the last step's configuration and finish setup.
 *
 * A route handler rather than a server action, for the reason app/api/setup/migrate/route.ts gives:
 * a server action re-renders the page it was called from, and this page redirects the moment
 * `getSetupState` answers "complete" - so the operator was thrown to the dashboard before the
 * restart could be explained, let alone performed. A fetch leaves the page mounted, which is what
 * lets the restart dialog happen in front of them.
 *
 * Whoever completes setup is the administrator. A signed-in session is required - this step runs
 * after the sign-in setup insists on, so there is a real user by now - but demanding that they
 * already *be* an admin made the OAuth branch of the account step a dead end: it stores a provider
 * and no user, so the user row is created by Better Auth's callback with `role: "user"`, and the
 * only place group-to-role mapping can be turned on is this very step. Promoting here rather than
 * relaxing the check outright matters: finishing setup with nobody an admin would leave a
 * completed instance with no way to reach Settings at all.
 */

export type CompleteSetupResponse =
  | {
      ok: true;
      /** Where to go once the app is back, as a path on whichever origin answers. */
      next: string;
      /** `restartToken` lets this browser, and only this one, ask /api/setup/restart. */
      restartToken: string;
      /** The origin the dashboard host now claims, to prefer over this one. Null when it has none. */
      dashboardOrigin: string | null;
    }
  | { ok: false; error: string };

function json(body: CompleteSetupResponse, status: number): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest): Promise<Response> {
  const originCheck = checkSameOrigin(request);
  if (originCheck) return originCheck;

  const t = await getTranslations("setup.errors");
  const session = await auth(request);
  if (!session?.user) {
    return json({ ok: false, error: t("signInToFinish") }, 401);
  }
  if (await isSetupCompleted()) {
    return json({ ok: false, error: t("alreadyCompleted") }, 409);
  }

  const formData = await request.formData();

  // Before the writes below, so the rest of this runs as an administrator. A no-op when the
  // account step already made one, which is every local-account setup - and for a second,
  // ordinary user reaching this step, which is what the check below still refuses.
  const promoted = await promoteFirstSetupAdmin(Number(session.user.id));
  if (!promoted && session.user.role !== "admin") {
    return json({ ok: false, error: t("adminToFinish") }, 403);
  }

  // Read from the registry rather than iterating the form, so a setting the form did not post is
  // still considered. Booleans compare against "on": the Switch wrapper in
  // components/ui/FormBooleanControls always submits a hidden input, empty when off, so a
  // presence check would read every toggle as true.
  const resolved = await resolveAllSettings();
  const values: Record<string, unknown> = {};

  for (const definition of SETTING_DEFINITIONS) {
    const raw = formData.get(definition.key);

    // A gate is stored tri-state but rendered as a switch, and setup is where the choice becomes
    // explicit: write a definite yes or no rather than the null that means "infer it".
    if (definition.gate) {
      values[definition.key] = raw === "on";
      continue;
    }

    if (typeof definition.default === "boolean") {
      // Nothing posted means the field was not rendered - a gated group whose switch is off. Left
      // alone rather than written false, which is what keeps a stored credential from being
      // cleared by turning its feature off.
      if (raw === null) continue;
      values[definition.key] = raw === "on";
      continue;
    }

    if (raw === null) continue;
    const text = String(raw);

    // A secret is never sent to the browser, so a blank one means "leave it alone" rather than
    // "clear it". Carry the resolved value across instead: the point of this step is that the
    // operator can delete the variable from their .env afterwards, which only holds if the value
    // actually lands in the database.
    if (definition.secret && text === "") {
      const current = resolved.get(definition.key)?.value;
      if (typeof current === "string" && current !== "") {
        values[definition.key] = current;
      }
      continue;
    }

    values[definition.key] = text;
  }

  // Refused rather than saved and quietly ignored, matching the Settings page: the ClickHouse
  // container will not start without a password, so "analytics on, no password" cannot become true.
  // `values` already carries a blank secret's stored value, so this sees what will actually land.
  if (values[analyticsEnabled.key] === true) {
    const password = values[clickhousePassword.key] ?? resolved.get(clickhousePassword.key)?.value;
    if (typeof password !== "string" || password.trim() === "") {
      return json({ ok: false, error: t("analyticsPasswordRequired") }, 400);
    }
  }

  // Not a registry setting: `general` is a JSON object older than the registry, and the Settings
  // page and the v1 API both read it from there. Validated through the same function that API
  // route uses rather than by hand, so the rules and the wording cannot drift apart.
  //
  // The two refusals an operator can actually cause are checked first, in their language. The
  // validator's own wording is REST's - field paths like `general.acmeEmail` - and stays only as
  // the backstop for anything this form cannot post.
  const defaultDomain = String(formData.get("defaultDomain") ?? "").trim();
  const acmeEmail = String(formData.get("acmeEmail") ?? "").trim();
  if (defaultDomain.length === 0 || defaultDomain.length > 253) {
    return json({ ok: false, error: t("defaultDomainInvalid") }, 400);
  }
  if (acmeEmail !== "" && !isEmailAddress(acmeEmail, "public")) {
    return json({ ok: false, error: t("acmeEmailInvalid") }, 400);
  }

  // Only posted while the card's switch is on - the domain field is hidden otherwise, the same way a
  // gated group's fields are. Checked here, before anything is written, because the save below is
  // best-effort and would otherwise swallow a typo into a dashboard that never comes up.
  const dashboardEnabled = formData.get("dashboardEnabled") === "on";
  const dashboardDomain = String(formData.get("dashboardDomain") ?? "").trim();
  if (dashboardEnabled && !isHostname(dashboardDomain)) {
    return json({ ok: false, error: t("dashboardDomainInvalid") }, 400);
  }

  let general: GeneralSettings;
  try {
    general = validateSettingsGroup("general", {
      defaultDomain,
      // Omitted rather than empty when blank: the validator treats the key as optional, and
      // storing "" would hand an empty contact to the ACME issuer instead of leaving it unset.
      ...(acmeEmail === "" ? {} : { acmeEmail }),
    }) as GeneralSettings;
  } catch (error) {
    if (error instanceof SettingsValidationError) {
      return json({ ok: false, error: error.message }, 400);
    }
    throw error;
  }

  try {
    await saveSettings(values);
    await saveGeneralSettings(general);
  } catch (error) {
    if (error instanceof SettingValidationError) {
      return json({ ok: false, error: error.message }, 400);
    }
    console.error("Setup: failed to save settings", error);
    return json({ ok: false, error: t("settingsSaveFailed") }, 500);
  }

  // Analytics and GeoIP decide whether a container runs, and the operator has just chosen. Without
  // this, setup would finish with ClickHouse still stopped and the client still holding whatever it
  // resolved before the form was filled in. Never throws - see the function's own note.
  await propagateOptionalFeatureSettings();

  const providerError = await createProviderFromForm(formData);
  if (providerError) return json({ ok: false, error: providerError }, 400);

  // CPM proxies its own dashboard from here on, unless the operator switched that off, so their
  // first look at the product is a working host rather than an empty list. Switched off, nothing is
  // stored: no dashboard settings already reads as off, and the Settings page seeds the domain the
  // same way this form did. Over HTTP: whether HTTPS would work is a question only
  // the reachability check can answer, and it cannot answer it until the route is live. Best-effort
  // on purpose - a settings write failing is not a reason to refuse a setup that has already saved
  // everything it was asked to.
  try {
    if (dashboardEnabled) {
      const copyFrom = copySourceFromForm(formData);
      const copied = copyFrom ? await dashboardSettingsFromHost(copyFrom, dashboardDomain) : null;
      await saveDashboardSettings(copied?.settings ?? activateDashboardHost(dashboardDomain));
      if (copied) {
        await retireCopiedHost(copied.host, copied.settings.domain, Number(session.user.id));
      }
    }
  } catch (error) {
    console.error("Setup: could not enable the dashboard host", error);
  }

  await markSetupCompleted();

  // A deployment that migrated has one more thing owed to it: its old database back, and a .env it
  // can safely replace. Everyone else goes to the dashboard.
  const migrated = (await getMigrationSource()) !== null;

  // Read back rather than rebuilt from the form: the write above is best-effort, and a dashboard
  // origin nothing was stored for would send the operator to a domain this instance never claimed.
  //
  // Not offered to a migrated deployment, whatever it claimed: the summary it is owed is behind the
  // session it has, and a session belongs to one address. Sent to the dashboard's domain it would
  // meet a sign-in page instead, and the summary is not shown twice. Its own last button goes
  // there.
  const dashboardOrigin = migrated ? null : dashboardHostOrigin(await getDashboardSettings());

  return json(
    {
      ok: true,
      next: migrated ? "/setup/done" : "/",
      restartToken: await issueRestartToken(),
      dashboardOrigin,
    },
    200,
  );
}

/** The stored host the operator chose to copy into the dashboard host, if they did. */
function copySourceFromForm(formData: FormData): number | null {
  if (formData.get("dashboardCopySettings") !== "on") return null;
  const id = Number(formData.get("dashboardCopyFromHostId"));
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Take the dashboard's domain away from the host its settings were copied from.
 *
 * The dashboard host wins the tie for an exact domain, so the old host would otherwise sit in the
 * list looking like it serves a name it never answers for. A host with no other domain is
 * disabled rather than deleted - it keeps its settings, and switching it back on is one click. One
 * with other domains keeps serving those. Best-effort, like the rest of the dashboard host here:
 * the copy has already been saved, and the shadowed host is harmless.
 */
async function retireCopiedHost(
  host: { id: number; domains: string[] },
  domain: string,
  actorUserId: number,
): Promise<void> {
  const remaining = host.domains.filter((claimed) => claimed.toLowerCase() !== domain);
  try {
    await updateProxyHost(
      host.id,
      remaining.length === 0 ? { enabled: false } : { domains: remaining },
      actorUserId,
    );
  } catch (error) {
    console.error("Setup: could not retire the host copied into the dashboard host", error);
  }
}

/**
 * Create the identity provider the settings step offered, if it was filled in.
 *
 * Returns a message rather than throwing, so a mistyped issuer leaves the operator on the form
 * with the rest of their configuration already saved rather than losing the page.
 *
 * Blank is the ordinary answer: a deployment signing in with a local administrator has no provider
 * to describe, and the card is optional for that reason. Partly filled is not - a name with no
 * client secret is a provider that cannot work, and silently skipping it would leave the operator
 * believing they had configured single sign-on.
 */
async function createProviderFromForm(formData: FormData): Promise<string | null> {
  const read = (key: string) => String(formData.get(key) ?? "").trim();
  const flag = (key: string) => formData.get(key) === "on";

  const name = read("idpName");
  const clientId = read("idpClientId");
  const clientSecret = read("idpClientSecret");
  const issuer = read("idpIssuer");

  const filled = [name, clientId, clientSecret, issuer].filter((value) => value !== "");
  if (filled.length === 0) return null;
  const t = await getTranslations("setup.errors");
  if (filled.length < 4) {
    return t("identityProviderIncomplete");
  }
  if (!/^https?:\/\/\S+$/.test(issuer)) {
    return t("issuerMustBeUrl");
  }

  // Re-checked here rather than trusted from the render: the page was drawn before the form was
  // filled in, and the account step can have created a provider in between.
  if ((await listOAuthProviders()).length > 0) {
    return null;
  }

  // Narrowed rather than cast: this is a posted string that createOAuthProvider stores as a role,
  // so anything unrecognised falls back instead of being written.
  const posted = read("idpDefaultRole");
  const defaultRole = isAppRole(posted) ? posted : "user";

  try {
    await createOAuthProvider({
      name,
      type: "oidc",
      clientId,
      clientSecret,
      issuer,
      authorizationUrl: read("idpAuthorizationUrl") || null,
      tokenUrl: read("idpTokenUrl") || null,
      userinfoUrl: read("idpUserinfoUrl") || null,
      scopes: read("idpScopes") || "openid email profile",
      autoLink: flag("idpAutoLink"),
      enabled: true,
      source: "ui",
      roleMappingEnabled: flag("idpRoleMapping"),
      groupsClaim: read("idpGroupsClaim") || "groups",
      groupPrefix: read("idpGroupPrefix"),
      adminGroup: read("idpAdminGroup"),
      operatorGroup: read("idpOperatorGroup"),
      userGroup: read("idpUserGroup"),
      viewerGroup: read("idpViewerGroup"),
      defaultRole,
      syncGroups: flag("idpSyncGroups"),
    });
  } catch (error) {
    console.error("Setup: failed to create the OAuth provider", error);
    return t("identityProviderCreateFailed");
  }

  return null;
}
