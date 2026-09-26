/**
 * Every live demo on every page hydrates, and nothing throws while it does.
 *
 * The build renders each demo once on the server, which catches an import that fails outright. It
 * does not run them in a browser, where the rest can go wrong: a shim that no longer matches what
 * a component calls, or server code a renamed import let into the bundle. A demo broken that way
 * sits on the page as dead markup, and nothing but a reader would notice.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const dist = fileURLToPath(new URL("../../dist/", import.meta.url));

/** Every built page that carries an island, as a path under the site's base. */
function pagesWithDemos(dir = dist): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return pagesWithDemos(path);
    if (entry.name !== "index.html" || !readFileSync(path, "utf8").includes("<astro-island")) {
      return [];
    }
    return [relative(dist, dir).replaceAll("\\", "/")];
  });
}

const pages = pagesWithDemos();

test("the build has demos to check", () => {
  expect(pages.length).toBeGreaterThan(0);
});

for (const page of pages) {
  test(`demos on /${page} hydrate cleanly`, async ({ page: browser }) => {
    const errors: string[] = [];
    browser.on("pageerror", (error) => errors.push(error.message));
    browser.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });

    await browser.goto(page ? `${page}/` : "./");
    const islands = browser.locator("astro-island");
    const count = await islands.count();
    expect(count).toBeGreaterThan(0);

    // Most demos are client:visible, so each has to be brought on screen before it will hydrate.
    // Astro drops the `ssr` attribute once an island has.
    for (let index = 0; index < count; index++) {
      const island = islands.nth(index);
      await island.scrollIntoViewIfNeeded();
      await expect(island).not.toHaveAttribute("ssr", { timeout: 15_000 });
    }

    expect(errors).toEqual([]);
  });
}
