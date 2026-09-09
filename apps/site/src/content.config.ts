import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";
import { defineCollection } from "astro:content";

/**
 * Only `docs`. Starlight also probes for an `i18n` collection and logs that it is empty, which is
 * accurate - English is the only catalog. Declaring it does not silence that; it adds a second
 * warning about the missing directory, since git cannot track an empty one. Add both together when
 * a translation actually arrives.
 */
export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
};
