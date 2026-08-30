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
  // Security headers (CSP, etc.) are set per-request in src/proxy.ts with a
  // unique nonce, so they are NOT defined here as static headers.
};

export default nextConfig;
