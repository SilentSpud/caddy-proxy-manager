/**
 * The username step's CAPTCHA check: verifies a widget token with its provider and, if it passes,
 * sets the pass the password step is refused without (see `lib/captcha/pass.ts`).
 *
 * A route rather than a server action because `LoginClient` is also rendered by the docs site,
 * which cannot bundle anything that reaches the database.
 */

import { getClientIp } from "@/src/lib/client-ip";
import {
  CAPTCHA_PASS_COOKIE,
  CAPTCHA_PASS_PATH,
  CAPTCHA_PASS_TTL_MS,
  issueCaptchaPass,
} from "@/src/lib/captcha/pass";
import { activeCaptcha, captchaSecret, getCaptchaSettings } from "@/src/lib/captcha/settings";
import { verifyCaptchaToken } from "@/src/lib/captcha/verify";
import { getPublicBaseUrl } from "@/src/lib/public-url";
import { takeFromWindow } from "@/src/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Each check is an outbound request to the provider, so one address may not drive many. */
const CHECKS_PER_WINDOW = 30;
const WINDOW_MS = 10 * 60_000;

export async function POST(request: Request) {
  const settings = await getCaptchaSettings();
  const active = activeCaptcha(settings);
  if (!active) return Response.json({ code: "CAPTCHA_DISABLED" }, { status: 404 });

  const ip = await getClientIp(request.headers);
  if (!takeFromWindow(`captcha:${ip ?? "unknown"}`, CHECKS_PER_WINDOW, WINDOW_MS)) {
    return Response.json({ code: "TOO_MANY_REQUESTS" }, { status: 429 });
  }

  let body: { username?: unknown; token?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ code: "CAPTCHA_FAILED" }, { status: 400 });
  }
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const token = typeof body.token === "string" ? body.token : "";
  if (!username || username.length > 255) {
    return Response.json({ code: "CAPTCHA_FAILED" }, { status: 400 });
  }

  const verdict = await verifyCaptchaToken(
    {
      provider: active.provider,
      siteKey: settings.siteKey,
      secret: captchaSecret(settings),
      capInstanceUrl: settings.capInstanceUrl,
    },
    token,
    ip,
  );
  if (verdict === "unavailable") {
    return Response.json({ code: "CAPTCHA_UNAVAILABLE" }, { status: 503 });
  }
  if (verdict === "failed") return Response.json({ code: "CAPTCHA_FAILED" }, { status: 403 });

  // Secure on the same terms Better Auth's own session cookie is, so the two are sent, or not,
  // together.
  const secure = (await getPublicBaseUrl()).toLowerCase().startsWith("https:");
  const cookie = [
    `${CAPTCHA_PASS_COOKIE}=${issueCaptchaPass(username)}`,
    `Path=${CAPTCHA_PASS_PATH}`,
    `Max-Age=${CAPTCHA_PASS_TTL_MS / 1000}`,
    "HttpOnly",
    "SameSite=Strict",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
  return Response.json({ ok: true }, { headers: { "Set-Cookie": cookie } });
}
