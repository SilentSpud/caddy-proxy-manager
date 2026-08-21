/**
 * Resolves what to show for a user's icon, in order of preference:
 *
 *   1. the icon they set themselves (an uploaded image, or a picture claim
 *      from their identity provider),
 *   2. their Gravatar, if the account has a real email address,
 *   3. their initial.
 *
 * Accounts created locally get a synthetic `<username>@localhost` address that
 * was never a mailbox. Hashing one and sending it to Gravatar would leak the
 * username for nothing — there can be no Gravatar behind it — so those accounts
 * skip straight to the initial.
 *
 * Hashing needs node:crypto, so resolution happens on the server and the result
 * is handed to the client as plain strings.
 */

import { createHash } from "node:crypto";

export const GRAVATAR_ORIGIN = "https://www.gravatar.com";

/**
 * Hostnames that only ever exist inside this deployment. `localhost` is what
 * init-db and the forward auth portal synthesise; the rest are the reserved
 * special-use names from RFC 6761/8375, which no public mail is delivered to.
 */
const NON_ROUTABLE_EMAIL_DOMAINS = new Set([
  "localhost",
  "localdomain",
  "local",
  "internal",
  "invalid",
  "test",
  "example",
  "home.arpa",
]);

export type AvatarUser = {
  name?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
};

/** What the client needs to render an avatar, with its fallbacks. */
export type ResolvedAvatar = {
  /** The user's own icon, when they have one. */
  imageUrl: string | null;
  /** Their Gravatar, tried when `imageUrl` is absent or fails to load. */
  gravatarUrl: string | null;
  /** Last resort, always present. */
  initial: string;
};

function normalizeEmail(email: string | null | undefined): string | null {
  const normalized = email?.trim().toLowerCase();
  return normalized || null;
}

/**
 * True when the address could not receive mail outside this deployment, and so
 * cannot have a Gravatar behind it.
 */
export function isNonRoutableEmail(email: string | null | undefined): boolean {
  const normalized = normalizeEmail(email);
  if (!normalized) return true;

  const at = normalized.lastIndexOf("@");
  if (at === -1) return true;

  const domain = normalized.slice(at + 1);
  if (!domain) return true;
  if (NON_ROUTABLE_EMAIL_DOMAINS.has(domain)) return true;

  // A bare hostname with no dot ("admin@server") is never publicly routable.
  if (!domain.includes(".")) return true;

  // ".local" and friends as a suffix, e.g. "user@box.local".
  const lastLabel = domain.slice(domain.lastIndexOf(".") + 1);
  return NON_ROUTABLE_EMAIL_DOMAINS.has(lastLabel);
}

/**
 * Gravatar's identifier is the SHA-256 of the trimmed, lowercased address.
 * Returns null when the address cannot have one.
 *
 * `d=404` is deliberate: rather than serving a generated placeholder, Gravatar
 * 404s when the address is unknown, the browser reports a load failure, and the
 * caller falls back to the initial. Without it every user would get a stranger's
 * auto-generated design instead of their own initial.
 */
export function gravatarUrl(email: string | null | undefined, size = 160): string | null {
  const normalized = normalizeEmail(email);
  if (!normalized || isNonRoutableEmail(normalized)) return null;

  const hash = createHash("sha256").update(normalized).digest("hex");
  return `${GRAVATAR_ORIGIN}/avatar/${hash}?s=${size}&d=404`;
}

/** The single character shown when there is no image to display. */
export function avatarInitial(user: AvatarUser): string {
  const source = user.name?.trim() || user.email?.trim() || "";
  // Take the first letter or digit, so a leading "@" or quote is skipped.
  const match = source.match(/[\p{L}\p{N}]/u);
  return (match?.[0] ?? "U").toUpperCase();
}

export type ResolveAvatarOptions = {
  /**
   * Whether the Gravatar fallback may be used. When false no Gravatar URL is
   * produced at all, so the browser never contacts gravatar.com — see
   * isGravatarEnabled() for where the answer comes from.
   */
  gravatar?: boolean;
};

export function resolveAvatar(
  user: AvatarUser,
  size = 160,
  options: ResolveAvatarOptions = {}
): ResolvedAvatar {
  const { gravatar = true } = options;
  const imageUrl = user.avatarUrl?.trim() || null;
  return {
    imageUrl,
    // Resolved even when a custom icon exists, so a broken or blocked icon URL
    // still falls through to the Gravatar rather than straight to the initial.
    gravatarUrl: gravatar ? gravatarUrl(user.email, size) : null,
    initial: avatarInitial(user),
  };
}
