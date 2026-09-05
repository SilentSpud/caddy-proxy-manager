/**
 * Serves the uploaded favicon, or 404 when the operator has not set one.
 *
 * Deliberately public — see the allowlist in src/proxy.ts. The login, portal and setup pages all
 * render before there is a session, and a favicon that redirected to /login would leave every
 * unauthenticated page without one. Nothing here is secret: a favicon is branding the browser
 * fetches for anyone who can reach the instance at all.
 */

import { NextResponse, type NextRequest } from "next/server";
import { getFavicon } from "@/src/lib/branding";

export async function GET(request: NextRequest) {
  const favicon = await getFavicon();

  // No custom icon is the normal case, and the browser treats it exactly as it treats the missing
  // /favicon.ico this app has always had. Not cached, so setting one takes effect immediately.
  if (!favicon) {
    return new NextResponse(null, { status: 404, headers: { "cache-control": "no-store" } });
  }

  const etag = `"${favicon.hash}"`;
  const headers: Record<string, string> = {
    "content-type": favicon.type,
    etag,
    // Revalidate every time rather than trusting a max-age: a favicon is fetched once in a while
    // and a stale one is what an operator would report as "the upload did not work". The ETag
    // makes the usual answer a 304 with no body.
    "cache-control": "no-cache, must-revalidate",
    "x-content-type-options": "nosniff",
    // An SVG opened directly is a document, and a document can carry script. This makes the
    // response inert whatever is inside it, which is what lets SVG be an accepted format at all.
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  };

  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers });
  }

  return new NextResponse(Buffer.from(favicon.data, "base64"), { headers });
}
