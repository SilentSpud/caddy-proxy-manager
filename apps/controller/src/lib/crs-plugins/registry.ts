/**
 * The OWASP CRS plugin registry (github.com/coreruleset/plugin-registry), and fetching a plugin's
 * rule files from its repository.
 *
 * The registry allocates each plugin a rule id range and says who vetted it; the files come from
 * the plugin's own repository, resolved to its latest release tag (or the default branch's commit
 * when it has none) so what was installed is recorded exactly. Nothing is written to disk: the
 * files are stored in the database and inlined into the WAF directives, because Caddy runs on the
 * agents' hosts and the embedded CRS is the only rule tree it has.
 */

import { findCrsPluginRejections } from "../caddy-waf";
import { domainError, domainErrorMessage } from "../domain-error";

const REGISTRY_URL =
  "https://raw.githubusercontent.com/coreruleset/plugin-registry/main/registry.json";
const GITHUB_API = "https://api.github.com";
const GITHUB_RAW = "https://raw.githubusercontent.com";

const FETCH_TIMEOUT_MS = 15_000;

/** The largest registered plugin is under 100 KiB; this only stops an endless body. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** The registry changes a few times a year, and every page load of the tab would ask otherwise. */
const REGISTRY_CACHE_MS = 60 * 60 * 1000;

const REPOSITORY = /^https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)\/?$/;
const PLUGIN_FILE = /^[A-Za-z0-9._-]+-(config|before|after)\.conf$/;
/** A tag or commit as it goes into a URL path. GitHub allows more; nothing registered uses it. */
const SAFE_REF = /^[A-Za-z0-9._/-]{1,200}$/;

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export type CrsRegistryEntry = {
  name: string;
  repository: string;
  type: "official" | "3rd-party";
  status: "tested" | "being-tested" | "untested" | "draft";
  license: string;
  ruleIdStart: number;
  ruleIdEnd: number;
  /** Why the plugin is known not to install, or null. See KNOWN_UNSUPPORTED. */
  unsupported: CrsUnsupportedReason | null;
};

export type CrsUnsupportedReason = "files" | "engine" | "compile" | "ruleIds" | "noRules";

/**
 * Registry plugins install refused when every entry was tried against the shipped Caddy image on
 * 2026-09-23. Checking live would take two GitHub API calls per plugin on every listing, well past
 * the unauthenticated limit. Only a hint for the listing: install still checks the release itself.
 */
const KNOWN_UNSUPPORTED: Readonly<Record<string, CrsUnsupportedReason>> = {
  "fake-bot": "files",
  "false-positive-report-plugin": "files",
  "netnea-crs-upgrading-plugin": "files",
  "wordpress-hardening-plugin": "files",
  antivirus: "engine",
  "auto-decoding": "engine",
  "body-decompress": "engine",
  "database-logging-plugin": "engine",
  "dos-protection-modsecurity": "compile",
  "google-oauth2": "compile",
  "traffic-observation-plugin": "ruleIds",
  "machine-learning-integration-plugin": "noRules",
};

export type CrsPluginRelease = {
  version: string;
  description: string | null;
  configRules: string;
  beforeRules: string;
  afterRules: string;
};

const TYPES = new Set(["official", "3rd-party"]);
const STATUSES = new Set(["tested", "being-tested", "untested", "draft"]);

/** Drops what cannot be installed or does not parse, rather than failing the whole listing. */
export function parseCrsRegistry(json: unknown): CrsRegistryEntry[] {
  const plugins = (json as { plugins?: unknown })?.plugins;
  if (!Array.isArray(plugins)) return [];
  const entries: CrsRegistryEntry[] = [];
  for (const raw of plugins) {
    const p = raw as Record<string, unknown>;
    const range = p?.rule_id_range as { start?: unknown; end?: unknown } | undefined;
    if (
      typeof p?.name !== "string" ||
      typeof p.repository !== "string" ||
      !REPOSITORY.test(p.repository) ||
      !TYPES.has(p.type as string) ||
      !STATUSES.has(p.status as string) ||
      !Number.isInteger(range?.start) ||
      !Number.isInteger(range?.end) ||
      // A private repository answers 404 to everyone outside it.
      p.private === true
    ) {
      continue;
    }
    entries.push({
      name: p.name,
      repository: p.repository.replace(/\/$/, ""),
      type: p.type as CrsRegistryEntry["type"],
      status: p.status as CrsRegistryEntry["status"],
      license: typeof p.license === "string" ? p.license : "",
      ruleIdStart: range!.start as number,
      ruleIdEnd: range!.end as number,
      unsupported: Object.hasOwn(KNOWN_UNSUPPORTED, p.name) ? KNOWN_UNSUPPORTED[p.name] : null,
    });
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

let registryCache: { at: number; entries: CrsRegistryEntry[] } | null = null;

/** For tests, which each bring their own registry. */
export function resetCrsRegistryCache(): void {
  registryCache = null;
}

async function get(fetcher: Fetcher, url: string, accept?: string): Promise<Response> {
  try {
    return await fetcher(url, {
      headers: {
        "User-Agent": "caddy-proxy-manager",
        ...(url.startsWith(GITHUB_API)
          ? {
              Accept: accept ?? "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
            }
          : {}),
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
    });
  } catch (error) {
    throw domainError(
      "crsPluginFetchFailed",
      { url, reason: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}

function failed(url: string, response: Response): never {
  // Unauthenticated, the GitHub API allows 60 requests an hour per address.
  if (response.status === 403 || response.status === 429) {
    throw domainError("crsPluginRateLimited", {}, { status: 400 });
  }
  throw domainError(
    "crsPluginFetchFailed",
    { url, reason: `HTTP ${response.status}` },
    { status: 400 },
  );
}

async function readText(url: string, response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  const text = declared > MAX_FILE_BYTES ? null : await response.text();
  if (text === null || text.length > MAX_FILE_BYTES) {
    throw domainError("crsPluginFetchFailed", { url, reason: "too large" }, { status: 400 });
  }
  return text.replace(/\r\n?/g, "\n");
}

export async function fetchCrsRegistry(fetcher: Fetcher = fetch): Promise<CrsRegistryEntry[]> {
  if (registryCache && Date.now() - registryCache.at < REGISTRY_CACHE_MS) {
    return registryCache.entries;
  }
  const response = await get(fetcher, REGISTRY_URL);
  if (!response.ok) failed(REGISTRY_URL, response);
  const text = await readText(REGISTRY_URL, response);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw domainError(
      "crsPluginFetchFailed",
      { url: REGISTRY_URL, reason: "not JSON" },
      { status: 400 },
    );
  }
  const entries = parseCrsRegistry(json);
  registryCache = { at: Date.now(), entries };
  return entries;
}

function repoPath(entry: Pick<CrsRegistryEntry, "repository">): string {
  const match = REPOSITORY.exec(entry.repository);
  if (!match) throw domainError("crsPluginNotInRegistry", {}, { status: 400 });
  return `${match[1]}/${match[2]}`;
}

/** The latest release tag, or the default branch's commit for a plugin that never tagged one. */
export async function resolveCrsPluginVersion(
  entry: Pick<CrsRegistryEntry, "repository">,
  fetcher: Fetcher = fetch,
): Promise<string> {
  const repo = repoPath(entry);
  const releaseUrl = `${GITHUB_API}/repos/${repo}/releases/latest`;
  const release = await get(fetcher, releaseUrl);
  let ref: unknown;
  if (release.ok) {
    ref = ((await release.json()) as { tag_name?: unknown }).tag_name;
  } else if (release.status === 404) {
    const commitUrl = `${GITHUB_API}/repos/${repo}/commits/HEAD`;
    const commit = await get(fetcher, commitUrl);
    if (!commit.ok) failed(commitUrl, commit);
    ref = ((await commit.json()) as { sha?: unknown }).sha;
  } else {
    failed(releaseUrl, release);
  }
  if (typeof ref !== "string" || !SAFE_REF.test(ref) || ref.includes("..")) {
    throw domainError(
      "crsPluginFetchFailed",
      { url: releaseUrl, reason: "no usable release" },
      { status: 400 },
    );
  }
  return ref;
}

function rawUrl(repo: string, ref: string, path: string): string {
  const encodedRef = ref.split("/").map(encodeURIComponent).join("/");
  return `${GITHUB_RAW}/${repo}/${encodedRef}/${path}`;
}

/** The plugin.yaml fields CPM reads. The descriptor is newer than most releases, so it is optional. */
async function fetchDescriptor(
  fetcher: Fetcher,
  repo: string,
  ref: string,
): Promise<{ description: string | null; engines: string[] | null }> {
  const url = rawUrl(repo, ref, "plugin.yaml");
  const response = await get(fetcher, url);
  if (!response.ok) return { description: null, engines: null };
  try {
    const doc = Bun.YAML.parse(await readText(url, response)) as {
      plugin?: { description?: unknown };
      compatibility?: { engines?: unknown };
    };
    const description = doc?.plugin?.description;
    const engines = doc?.compatibility?.engines;
    return {
      description:
        typeof description === "string" && description.trim() ? description.trim() : null,
      engines: Array.isArray(engines)
        ? engines.filter((e): e is string => typeof e === "string")
        : null,
    };
  } catch {
    return { description: null, engines: null };
  }
}

/**
 * Fetches and checks a plugin's rule files at `version`. Throws, naming each refused line, rather
 * than returning a plugin that would be half emitted.
 */
export async function fetchCrsPluginRelease(
  entry: CrsRegistryEntry,
  version: string,
  fetcher: Fetcher = fetch,
): Promise<CrsPluginRelease> {
  const repo = repoPath(entry);
  const listUrl = `${GITHUB_API}/repos/${repo}/contents/plugins?ref=${encodeURIComponent(version)}`;
  const listing = await get(fetcher, listUrl);
  if (listing.status === 404) throw domainError("crsPluginNoRuleFiles", {}, { status: 400 });
  if (!listing.ok) failed(listUrl, listing);
  const files = ((await listing.json()) as { name?: unknown; type?: unknown }[])
    .filter((f) => f?.type === "file" && typeof f.name === "string" && PLUGIN_FILE.test(f.name))
    .map((f) => f.name as string)
    .sort();
  if (files.length === 0) throw domainError("crsPluginNoRuleFiles", {}, { status: 400 });

  const descriptor = await fetchDescriptor(fetcher, repo, version);
  if (
    descriptor.engines &&
    descriptor.engines.length > 0 &&
    !descriptor.engines.includes("coraza") &&
    !descriptor.engines.includes("all")
  ) {
    throw domainError(
      "crsPluginEngineIncompatible",
      { engines: descriptor.engines },
      { status: 400 },
    );
  }

  const rules = { config: [] as string[], before: [] as string[], after: [] as string[] };
  for (const name of files) {
    // Built from the repository rather than taken from the listing's download_url, so a listing
    // can only ever point back into the same repository.
    const url = rawUrl(repo, version, `plugins/${encodeURIComponent(name)}`);
    const response = await get(fetcher, url);
    if (!response.ok) failed(url, response);
    rules[PLUGIN_FILE.exec(name)![1] as keyof typeof rules].push(
      (await readText(url, response)).trim(),
    );
  }

  const release: CrsPluginRelease = {
    version,
    description: descriptor.description,
    configRules: rules.config.join("\n"),
    beforeRules: rules.before.join("\n"),
    afterRules: rules.after.join("\n"),
  };
  assertCrsPluginRulesLoadable(
    [release.configRules, release.beforeRules, release.afterRules],
    entry.ruleIdStart,
    entry.ruleIdEnd,
  );
  return release;
}

/** At most this many refused lines are named; a plugin built around Lua would list dozens. */
const MAX_NAMED_REJECTIONS = 3;

export function assertCrsPluginRulesLoadable(
  files: readonly string[],
  ruleIdStart: number,
  ruleIdEnd: number,
): void {
  const rejections = files.flatMap((text) =>
    findCrsPluginRejections(text, { start: ruleIdStart, end: ruleIdEnd }),
  );
  if (rejections.length === 0) return;
  const range = { start: String(ruleIdStart), end: String(ruleIdEnd) };
  const details = rejections
    .slice(0, MAX_NAMED_REJECTIONS)
    .map((entry) => `"${entry.line.slice(0, 160)}" - ${domainErrorMessage(entry.reason, range)}`);
  throw domainError("crsPluginRejected", { count: rejections.length, details }, { status: 400 });
}
