/**
 * A real OIDC provider for tests, without a browser and without the compose stack.
 *
 * `mock-oauth2-server` with `interactiveLogin: false` issues an authorization code straight from
 * /authorize instead of rendering a login form, so a complete sign-in is three fetches. That
 * matters because OAuth is the part of auth the fast suites cannot otherwise reach: the unit tests
 * stub `betterAuth` entirely, and everything else drives the adapter directly, which misses the
 * queries Better Auth only builds during a callback. Before this existed, an OAuth regression was
 * invisible until the end-to-end suite ran — after a push, and 14 minutes later.
 *
 * Start it with:
 *
 *   docker run -d --name cpm-idp -p 5599:8080 \
 *     -e JSON_CONFIG='<the JSON printed by `bun tests/helpers/mock-idp.ts`>' \
 *     ghcr.io/navikt/mock-oauth2-server:2.1.10
 *
 * Pass the config through JSON_CONFIG rather than mounting tests/mock-oidc/config.json: the bind
 * mount silently fails on Windows and the server falls back to interactive login, which then hangs
 * the flow on an HTML form instead of failing usefully.
 */

/** Where the IdP is reachable. TEST_OIDC_URL lets CI point at a service container. */
export const MOCK_IDP_URL = (process.env.TEST_OIDC_URL ?? 'http://localhost:5599').replace(
  /\/$/,
  '',
);

/** The issuer for the "default" realm, which is what the app is configured with. */
export const MOCK_IDP_ISSUER = `${MOCK_IDP_URL}/default`;

/** Claims the IdP returns. `role: "admin"` is deliberate — see oauth-flow.test.ts. */
export const MOCK_IDP_CLAIMS = {
  sub: 'test-oauth-user',
  email: 'oauth@test.local',
  email_verified: true,
  name: 'Test OAuth User',
  role: 'admin',
} as const;

/**
 * The JSON_CONFIG value the container needs. Exported so the docs above, CI and any local run all
 * use one definition rather than three that drift.
 */
export const MOCK_IDP_JSON_CONFIG = JSON.stringify({
  interactiveLogin: false,
  httpServer: 'NettyWrapper',
  tokenCallbacks: [
    {
      issuerId: 'default',
      requestMappings: [
        { requestParam: 'grant_type', match: 'authorization_code', claims: MOCK_IDP_CLAIMS },
      ],
    },
  ],
});

/** Whether the IdP is up, so a suite can skip rather than fail when nobody started it. */
export async function isMockIdpReachable(): Promise<boolean> {
  try {
    const response = await fetch(`${MOCK_IDP_ISSUER}/.well-known/openid-configuration`, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export type OAuthSignInResult = {
  /** Where the app redirected after the callback. Contains "error" when sign-in failed. */
  location: string;
  ok: boolean;
  /** Session cookies the callback set, ready to replay on a later request. */
  cookie: string;
};

/**
 * Run a full OAuth sign-in against the mock IdP and return where the app landed.
 *
 * `auth.handler` is called directly rather than over HTTP — nothing has to be listening on
 * BASE_URL, only the redirect_uri has to match what the provider was registered with.
 */
export async function completeOAuthSignIn(
  auth: any,
  options: { providerId: string; baseUrl?: string },
): Promise<OAuthSignInResult> {
  const base = (options.baseUrl ?? 'http://localhost:3000').replace(/\/$/, '');
  const cookies = new Map<string, string>();

  const absorb = (response: Response) => {
    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';');
      const index = pair.indexOf('=');
      if (index > 0) cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
  };
  const cookieHeader = () => [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');

  // Since Better Auth 1.7 the generic-OAuth plugin registers each provider as a first-class social
  // provider, so this is /sign-in/social — /sign-in/oauth2 does not exist and returns 404.
  const startResponse = await auth.handler(
    new Request(`${base}/api/auth/sign-in/social`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ provider: options.providerId, callbackURL: '/' }),
    }),
  );
  absorb(startResponse);
  const startBody = (await startResponse.json().catch(() => ({}))) as { url?: string };
  if (!startBody.url) {
    throw new Error(
      `OAuth start failed: HTTP ${startResponse.status} ${JSON.stringify(startBody)}`,
    );
  }

  // interactiveLogin:false means /authorize answers with the redirect itself.
  const idpResponse = await fetch(startBody.url, { redirect: 'manual' });
  const callbackUrl = idpResponse.headers.get('location');
  if (!callbackUrl) {
    throw new Error(
      `IdP did not redirect (HTTP ${idpResponse.status}) — it is probably running with ` +
        `interactiveLogin enabled, which serves an HTML login form instead.`,
    );
  }

  const callbackResponse = await auth.handler(
    new Request(callbackUrl, { headers: { cookie: cookieHeader() }, redirect: 'manual' }),
  );
  absorb(callbackResponse);
  const location = callbackResponse.headers.get('location') ?? '';

  return { location, ok: location !== '' && !location.includes('error'), cookie: cookieHeader() };
}

// `bun tests/helpers/mock-idp.ts` prints the config, so the docker command above can be pasted
// together without hand-copying JSON.
if (import.meta.main) {
  console.log(MOCK_IDP_JSON_CONFIG);
}
