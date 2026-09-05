/**
 * The favicon an operator can upload to replace the one the browser shows for this instance.
 *
 * Held in the database rather than on disk, for the same reason the rest of the configuration is:
 * a deployment's data volume is per-instance and per-host, while the database is the one thing
 * every instance already shares. It is a `settings` blob rather than a registry entry because the
 * registry is scalars migrating out of `.env` — a base64 image was never an environment variable,
 * and `resolveAllSettings` loads every registry key at once, so putting one there would drag the
 * image into every page that reads any setting.
 */

import { createHash } from "node:crypto";
import { clearSetting, getSetting, setSetting } from "./settings";

const BRANDING_KEY = "branding";

/**
 * Largest favicon accepted, before base64.
 *
 * Far above anything a favicon needs — a 180×180 PNG is around 20 KB — and far below the 2 MB
 * server-action body limit, so the failure an operator hits is this message rather than a request
 * the framework rejected with none.
 */
export const MAX_FAVICON_BYTES = 256 * 1024;

export type FaviconAsset = {
  /** The file exactly as uploaded, base64-encoded. */
  data: string;
  /** The type sniffed from the bytes. Never the browser's claim — see sniffFaviconType. */
  type: string;
  /** Content hash, served as the ETag so replacing the icon invalidates the cached one at once. */
  hash: string;
};

export type BrandingSettings = { favicon: FaviconAsset | null };

export class FaviconValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FaviconValidationError";
  }
}

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

/** ASCII bytes for a magic string, for the formats whose signature is text. */
function ascii(text: string): number[] {
  return [...text].map((character) => character.charCodeAt(0));
}

/**
 * The image type, decided from the bytes rather than from what the browser said.
 *
 * The uploaded `File.type` is attacker-controlled: it comes from the client, and this value is what
 * the favicon route later hands back as `Content-Type`. Sniffing means a file cannot be stored as
 * one thing and served as another — which is the whole trick behind serving an "image" that the
 * browser is willing to treat as a document.
 */
export function sniffFaviconType(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  // An .ico is a header of 00 00 01 00; the cursor variant (02) is deliberately not accepted.
  if (startsWith(bytes, [0x00, 0x00, 0x01, 0x00])) return "image/x-icon";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, ascii("GIF87a")) || startsWith(bytes, ascii("GIF89a"))) return "image/gif";
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) return "image/webp";

  // SVG has no magic number, so it is identified by its root element — after stripping whatever
  // prologue precedes it. Each of the declaration, comments and the doctype is optional and may
  // repeat, so they come off in a loop rather than in one pattern trying to spell every ordering.
  // TextDecoder strips a leading BOM itself when ignoreBOM is left at its default, so a UTF-8 SVG
  // saved with one needs nothing further here.
  let head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 1024)).trimStart();

  for (;;) {
    const shortened = head
      .replace(/^<\?xml[\s\S]*?\?>\s*/i, "")
      .replace(/^<!--[\s\S]*?-->\s*/, "")
      .replace(/^<!DOCTYPE[^>]*>\s*/i, "");
    if (shortened === head) break;
    head = shortened;
  }

  if (/^<svg[\s/>]/i.test(head)) return "image/svg+xml";

  return null;
}

/**
 * Validate an uploaded file and store it as the instance's favicon.
 *
 * Throws `FaviconValidationError` with something an operator can act on; anything else is a bug.
 */
export async function saveFavicon(file: File): Promise<FaviconAsset> {
  if (file.size === 0) throw new FaviconValidationError("That file is empty.");
  if (file.size > MAX_FAVICON_BYTES) {
    throw new FaviconValidationError(
      `That file is ${Math.ceil(file.size / 1024)} KB. The limit is ${MAX_FAVICON_BYTES / 1024} KB.`,
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffFaviconType(bytes);
  if (!type) {
    throw new FaviconValidationError(
      "That does not look like an image. Use a PNG, ICO, SVG, WebP, GIF or JPEG.",
    );
  }

  const buffer = Buffer.from(bytes);
  const favicon: FaviconAsset = {
    data: buffer.toString("base64"),
    type,
    hash: createHash("sha256").update(buffer).digest("hex").slice(0, 32),
  };

  await setSetting<BrandingSettings>(BRANDING_KEY, { favicon });
  return favicon;
}

export async function getFavicon(): Promise<FaviconAsset | null> {
  const branding = await getSetting<BrandingSettings>(BRANDING_KEY);
  return branding?.favicon ?? null;
}

/** Remove the custom favicon, so the browser falls back to showing none. */
export async function clearFavicon(): Promise<void> {
  await clearSetting(BRANDING_KEY);
}
