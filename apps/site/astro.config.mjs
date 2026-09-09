// @ts-check
import { fileURLToPath } from "node:url";
import react from "@astrojs/react";
import starlight from "@astrojs/starlight";
import catppuccin from "@catppuccin/starlight";
import { defineConfig } from "astro/config";

/**
 * Absolute path inside the controller workspace, for the aliases below.
 *
 * @param {string} path
 */
const controller = (path) => fileURLToPath(new URL(`../controller/${path}`, import.meta.url));

/**
 * `satteri` in this app's dependencies is not imported by anything here, and is not cruft.
 *
 * It is Starlight's markdown engine, and it loads a per-platform native binding by `require`. The
 * static build inlines it into a prerender chunk, from which that require resolves upwards through
 * `dist/` - and bun keeps transitive dependencies in `node_modules/.bun/node_modules`, which is not
 * on that path, so the binding is unfindable and every page carrying a Starlight component fails to
 * render. Depending on it directly puts it in `apps/site/node_modules`, which is on the path.
 * Remove it and the build breaks with "Cannot find native binding".
 */

/**
 * The project site, built as static files and served from GitHub Pages.
 *
 * `site` and `base` are what Pages needs and what a custom domain would change. A project site
 * lives under `https://<owner>.github.io/<repo>/`, so every absolute link and asset URL has to
 * carry that prefix - Astro does it for you, but only if `base` says so. Moving to a custom domain
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
       * The palette. Catppuccin restates Starlight's accent and grey ramps, which is where almost
       * all of the site's colour comes from, so the theme carries the brand on its own and the
       * hand-written override file it replaced is gone.
       *
       * `lavender` is the accent nearest the indigo the old site used, and it is the same accent
       * in both modes so the brand does not change with the reader's setting. `mocha` is the
       * darkest of the three dark flavours; `latte` is the only light one.
       *
       * The plugin appends its stylesheets to `customCss` rather than replacing it, so demo.css
       * below is loaded first. That is the right way round: demo.css only ever reads --sl-color-*,
       * so it wants the theme's definitions to land after it.
       *
       * It also depends on `@astrojs/starlight` outright rather than as a peer, and ships its
       * entry as TypeScript source. Left alone that pulls a second, older Starlight into the tree
       * and `bun run typecheck` follows the import into its uncompiled internals, which reference
       * virtual modules that only exist for this app's own copy. The `overrides` entry in the root
       * package.json pins one version, which is why it is there.
       */
      plugins: [
        catppuccin({
          dark: { flavor: "mocha", accent: "lavender" },
          light: { flavor: "latte", accent: "lavender" },
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
