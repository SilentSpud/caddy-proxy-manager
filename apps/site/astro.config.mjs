// @ts-check
import { fileURLToPath } from "node:url";
import react from "@astrojs/react";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import starlightRosePine from "starlight-theme-rose-pine";

/**
 * Absolute path inside the controller workspace, for the aliases below.
 *
 * @param {string} path
 */
const controller = (path) => fileURLToPath(new URL(`../controller/${path}`, import.meta.url));

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
    react(),
    starlight({
      title: "Caddy Proxy Manager",
      description:
        "A modern web interface for Caddy Server: reverse proxy, WAF, automatic HTTPS, mTLS, forward auth, geo blocking, L4 TCP/UDP proxying, traffic analytics and a GraphQL API.",
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
      /*
       * The palette. Rosé Pine restates Starlight's accent and grey ramps, which is where almost
       * all of the site's colour comes from, so the theme carries the brand on its own and the
       * hand-written override file it replaced is gone.
       *
       * `iris` is the accent nearest the indigo the old site used, and it is the same accent in
       * both modes so the brand does not change with the reader's setting. The flavours are the
       * defaults, named here because they are the choice worth seeing: `main` for dark, `dawn`
       * for light.
       */
      plugins: [
        starlightRosePine({
          dark: { flavor: "main", accent: "iris" },
          light: { flavor: "dawn", accent: "iris" },
        }),
      ],
      customCss: ["./src/styles/demo.css"],
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
            { label: "API", slug: "features/api" },
            { label: "Audit log", slug: "features/audit-log" },
          ],
        },
      ],
    }),
  ],

  vite: {
    resolve: {
      /**
       * The demos render the controller's own components rather than copies, so the docs cannot
       * drift from the product. Three of the controller's tsconfig paths have to be repeated here
       * for its imports to resolve from this app; the fourth (`@/*`) is ambiguous by design there
       * and unused by anything a demo pulls in.
       *
       * The two shims stand in for framework packages the components import but do not need: only
       * `useTranslations` is used from next-intl, and `next/navigation` is reached by one
       * component. Both resolve to a few lines each rather than dragging Next into a static site.
       */
      alias: [
        { find: /^@\/components\//, replacement: `${controller("src/components")}/` },
        { find: /^@\/lib\//, replacement: `${controller("src/lib")}/` },
        { find: /^@\/src\//, replacement: `${controller("src")}/` },
        {
          find: /^next-intl$/,
          replacement: fileURLToPath(new URL("./src/demos/shims/next-intl.ts", import.meta.url)),
        },
        {
          find: /^next\/navigation$/,
          replacement: fileURLToPath(
            new URL("./src/demos/shims/next-navigation.ts", import.meta.url),
          ),
        },
      ],
      // The controller is a workspace symlink, so its React would otherwise resolve to a second
      // copy and every hook in a demo would throw.
      dedupe: ["react", "react-dom"],
    },
  },
});
