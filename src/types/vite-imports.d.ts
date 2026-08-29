/**
 * Vite's `?worker` suffix, declared locally rather than pulling in `vite/client` types, whose
 * `ImportMeta` augmentation and asset declarations clash with the Next.js and Bun types.
 */
declare module "*?worker" {
  const workerConstructor: new () => Worker;
  export default workerConstructor;
}

/**
 * Vite's `?worker&url` — bundles the module graph like `?worker`, but resolves to the emitted
 * chunk's URL rather than a constructor.
 */
declare module "*?worker&url" {
  const url: string;
  export default url;
}

/** Vite's `?url` suffix — an asset's emitted URL. Declared here for the same reason as above. */
declare module "*?url" {
  const url: string;
  export default url;
}
