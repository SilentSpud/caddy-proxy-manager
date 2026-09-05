import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/src/lib/auth";
import { config } from "@/src/lib/config";
import { listOAuthProviders } from "@/src/lib/models/oauth-providers";
import { getGeneralSettings } from "@/src/lib/settings";
import { baseUrl, SETTING_DEFINITIONS, SETTING_GROUPS } from "@/src/lib/settings/registry";
import { gateDefaults } from "@/src/lib/settings/optional-features";
import { resolveAllSettings } from "@/src/lib/settings/resolve";
import { getSetupState, SETUP_PATHS } from "@/src/lib/setup";
import SetupSettingsClient, { type SettingField } from "./SetupSettingsClient";

export const metadata: Metadata = {
  title: { absolute: "Finish setting up" },
};

const GROUP_TITLES: Record<(typeof SETTING_GROUPS)[number], string> = {
  application: "Application",
  authentication: "Sign-in and accounts",
  analytics: "Analytics",
  geoip: "GeoIP",
};

export default async function SetupSettingsPage() {
  const session = await auth();
  const { stage } = await getSetupState(!!session?.user);
  if (stage !== "settings") {
    redirect(SETUP_PATHS[stage]);
  }

  const [resolved, gates, general, providers] = await Promise.all([
    resolveAllSettings(),
    gateDefaults(),
    getGeneralSettings(),
    listOAuthProviders(),
  ]);

  // Secrets are never sent to the browser. An operator re-entering one is a small cost next to a
  // page that ships the ClickHouse password in its HTML.
  const fields: SettingField[] = SETTING_DEFINITIONS.map((definition) => {
    const current = resolved.get(definition.key);
    return {
      key: definition.key,
      env: definition.env,
      group: definition.group,
      label: definition.label,
      description: definition.description,
      kind:
        typeof definition.default === "boolean"
          ? "boolean"
          : typeof definition.default === "number"
            ? "number"
            : definition.default === null
              ? "tristate"
              : "string",
      secret: definition.secret === true,
      gate: definition.gate === true,
      // A gate is stored tri-state but rendered as a switch, so an unset one has to arrive as the
      // answer the app is currently acting on rather than as `null` — which a switch would show as
      // off, offering to disable something that is already running.
      value: definition.gate
        ? (gates[definition.key] ?? false)
        : definition.secret
          ? ""
          : (current?.value ?? definition.default),
      source: current?.source ?? "default",
    };
  });

  return (
    <SetupSettingsClient
      fields={fields}
      groups={SETTING_GROUPS.map((group) => ({ id: group, title: GROUP_TITLES[group] }))}
      general={{
        primaryDomain:
          general?.primaryDomain ?? domainFromBaseUrl(resolved.get(baseUrl.key)?.value),
        acmeEmail: general?.acmeEmail ?? "",
      }}
      oauth={oauthCard(providers.map((provider) => provider.name))}
    />
  );
}

/**
 * The identity-provider card: what is already configured, or the OAUTH_* values to take over.
 *
 * A provider is a row in `oauth_providers`, not a registry setting, so this is the one part of the
 * page not generated from the registry. It is here because the account step only asks about OAuth
 * on the branch where it is the *only* way in — an operator who created a local administrator was
 * never offered it, and had to find Settings afterwards.
 *
 * The prefill is the same bargain the rest of the page makes: values are read out of the
 * environment, and saving is what moves them into the database so the variables can be deleted.
 * The client secret is prefilled too, unlike every other secret here, because a provider cannot be
 * created without one — and it is precisely the value the operator is about to be able to delete
 * from the file it currently lives in.
 */
function oauthCard(existing: string[]) {
  const { oauth } = config;

  // What decides is a client ID, or the switch being on. Not the provider name: config.ts gives
  // that one a fallback of "OAuth2" whether or not anything is configured, and carrying that into
  // the form made a card nobody had touched look half filled — which the save then refused,
  // stopping setup on a deployment that had never mentioned OAuth at all.
  const fromEnvironment = oauth.enabled || !!oauth.clientId;

  // Blank means blank. The three below keep their defaults either way: they are the values the
  // advanced fields would show anyway, and none of them is part of what counts as "filled in".
  const blank = {
    providerName: "",
    issuer: "",
    clientId: "",
    clientSecret: "",
    authorizationUrl: "",
    tokenUrl: "",
    userinfoUrl: "",
    scopes: "openid email profile",
    autoLink: false,
    roleMappingEnabled: false,
    groupsClaim: "groups",
    groupPrefix: "",
    adminGroup: "",
    userGroup: "",
    viewerGroup: "",
    defaultRole: "user",
    syncGroups: false,
  };

  if (!fromEnvironment) return { existing, fromEnvironment, prefill: blank };

  return {
    existing,
    fromEnvironment,
    prefill: {
      providerName: oauth.providerName ?? "",
      issuer: oauth.issuer ?? "",
      clientId: oauth.clientId ?? "",
      clientSecret: oauth.clientSecret ?? "",
      authorizationUrl: oauth.authorizationUrl ?? "",
      tokenUrl: oauth.tokenUrl ?? "",
      userinfoUrl: oauth.userinfoUrl ?? "",
      scopes: oauth.scopes ?? blank.scopes,
      autoLink: oauth.allowAutoLinking,
      roleMappingEnabled: oauth.roleMappingEnabled,
      groupsClaim: oauth.groupsClaim ?? blank.groupsClaim,
      groupPrefix: oauth.groupPrefix ?? "",
      adminGroup: oauth.adminGroup ?? "",
      userGroup: oauth.userGroup ?? "",
      viewerGroup: oauth.viewerGroup ?? "",
      defaultRole: oauth.defaultRole ?? blank.defaultRole,
      syncGroups: oauth.syncGroups,
    },
  };
}

/**
 * A first guess at the primary domain, taken from the URL this instance is reached at.
 *
 * The field is required and setup cannot finish without it, so it opens with the answer that is
 * right for almost everyone rather than a blank to think about. `localhost` is not excluded: on a
 * deployment reached at localhost that is genuinely the name, and proposing nothing there would
 * hand exactly the deployments used for trying this out an empty required field.
 *
 * BASE_URL has a default, so there is always something to read — the fallback covers a stored
 * value that somehow is not a URL, not the ordinary case.
 */
function domainFromBaseUrl(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") return "";
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}
