/** @type {import('next').NextConfig} */
const nextConfig = {
  // bun:sqlite is a Bun built-in: leave it to the runtime rather than letting
  // the bundler try to resolve it. Bun is the only supported runtime, so there
  // is no Node.js fallback to alias it to.
  serverExternalPackages: ["bun:sqlite"],
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
  output: "standalone",
  poweredByHeader: false,
  // Every request gets its metadata in <head>, the way a crawler would. Left to the default, vinext
  // streams the metadata of any route with a generateMetadata - every page, since titles are
  // translated - into a hidden <div> at the end of <body>, where `<title>` is page text that
  // Playwright's getByText matches alongside the heading it names. Each generateMetadata here is a
  // catalog lookup, so waiting for it before the shell costs nothing.
  htmlLimitedBots: /.*/,
  // Security headers (CSP, etc.) are set per-request in src/proxy.ts with a
  // unique nonce, so they are NOT defined here as static headers.
};

export default nextConfig;
