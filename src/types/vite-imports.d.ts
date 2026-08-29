/**
 * Vite's `?worker` import suffix, declared locally rather than pulling in `vite/client` types,
 * whose `ImportMeta` augmentation and asset declarations clash with the Next.js and Bun types.
 */
declare module "*?worker" {
  const workerConstructor: new () => Worker;
  export default workerConstructor;
}

/**
 * Vite's `?worker&url` — bundles the worker's module graph like `?worker`, but resolves to the
 * emitted chunk's URL rather than a constructor, for libraries that spawn the worker themselves.
 */
declare module "*?worker&url" {
  const url: string;
  export default url;
}

/**
 * Vite's `?url` import suffix — resolves an asset to the URL the bundler emits it at. Declared
 * here for the same reason as `?worker` above.
 */
declare module "*?url" {
  const url: string;
  export default url;
}
