/**
 * Country and territory names in the reader's language. `Intl.DisplayNames` rather than a
 * hand-kept table: the runtime already carries CLDR's name for every region in every locale we
 * might add, and a table would only ever be English. The analytics map, its country breakdown and
 * the geoblock picker all name codes through here, so they agree on what a code is called.
 */

const cache = new Map<string, Intl.DisplayNames>();

/** The display name of an ISO 3166-1 alpha-2 code in `locale`, or the code when there is none. */
export function regionName(code: string, locale: string): string {
  let names = cache.get(locale);
  if (!names) {
    names = new Intl.DisplayNames([locale], { type: "region" });
    cache.set(locale, names);
  }
  try {
    return names.of(code) ?? code;
  } catch {
    // `of` throws on anything that is not shaped like a region code.
    return code;
  }
}
