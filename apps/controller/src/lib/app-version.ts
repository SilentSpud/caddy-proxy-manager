// Application version, inlined at build time by vite.config.ts.
// That config resolves it from the APP_VERSION build arg (set by CI from the
// git tag for release builds) and falls back to the version in package.json.
// It arrives as a define rather than a package.json import so the rest of the
// manifest stays out of the client bundle.
export const APP_VERSION: string = process.env.NEXT_PUBLIC_APP_VERSION?.trim() || "unknown";

export function formatAppVersion(version: string = APP_VERSION): string {
  return `v${version}`;
}
