// @ts-check
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

/**
 * The project site, built as static files and served from GitHub Pages.
 *
 * `site` and `base` are what Pages needs and what a custom domain would change. A project site
 * lives under `https://<owner>.github.io/<repo>/`, so every absolute link and asset URL has to
 * carry that prefix — Astro does it for you, but only if `base` says so. Moving to a custom domain
 * later is two edits: point `site` at it, set `base` to "/", and add a CNAME file to `public/`.
 */
export default defineConfig({
  site: "https://silentspud.github.io",
  base: "/caddy-proxy-manager",
  integrations: [
    starlight({
      title: "Caddy Proxy Manager",
      description:
        "A modern web interface for Caddy Server: reverse proxy, WAF, automatic HTTPS, mTLS, forward auth, geo blocking, L4 TCP/UDP proxying, traffic analytics and a full REST API.",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/SilentSpud/caddy-proxy-manager",
        },
      ],
      editLink: {
        baseUrl: "https://github.com/SilentSpud/caddy-proxy-manager/edit/main/apps/site/",
      },
      customCss: ["./src/styles/theme.css"],
      // Written out rather than generated from the directory: the order these appear in is the
      // order someone new should meet them, which is not alphabetical and not the order the files
      // happen to sit in.
      sidebar: [
        {
          label: "Start here",
          items: [
            { label: "What it is", slug: "start/what-it-is" },
            { label: "Install", slug: "start/install" },
            { label: "First run", slug: "start/first-run" },
          ],
        },
        {
          label: "Traffic",
          items: [
            { label: "Reverse proxy", slug: "features/reverse-proxy" },
            { label: "L4 TCP/UDP proxy", slug: "features/l4-proxy" },
            { label: "Certificates & HTTPS", slug: "features/certificates" },
            { label: "Dashboard host", slug: "features/dashboard-host" },
          ],
        },
        {
          label: "Protection",
          items: [
            { label: "WAF", slug: "features/waf" },
            { label: "Geo blocking", slug: "features/geo-blocking" },
            { label: "Access lists & mTLS", slug: "features/access-control" },
            { label: "Forward auth", slug: "features/forward-auth" },
          ],
        },
        {
          label: "Operations",
          items: [
            { label: "Analytics", slug: "features/analytics" },
            { label: "Users, roles & groups", slug: "features/users-and-groups" },
            { label: "The agent", slug: "features/agent" },
            { label: "Caddy Build", slug: "features/caddy-build" },
            { label: "Tailscale", slug: "features/tailscale" },
            { label: "REST API", slug: "features/rest-api" },
            { label: "Audit log", slug: "features/audit-log" },
          ],
        },
      ],
    }),
  ],
});
