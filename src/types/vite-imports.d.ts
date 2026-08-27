/**
 * Vite's `?worker` import suffix, declared locally rather than by pulling in
 * `vite/client` types wholesale — that would also add Vite's `ImportMeta`
 * augmentation and its asset-module declarations, which conflict with the
 * Next.js and Bun types this project already loads.
 */
declare module "*?worker" {
  const workerConstructor: new () => Worker;
  export default workerConstructor;
}

/**
 * Vite's `?worker&url` combination — bundles the worker's module graph like
 * `?worker`, but resolves to the URL of the emitted chunk rather than to a
 * constructor, for libraries that want to spawn the worker themselves.
 */
declare module "*?worker&url" {
  const url: string;
  export default url;
}

/**
 * Vite's `?url` import suffix — resolves an asset to the URL the bundler emits
 * it at. Declared here for the same reason as `?worker` above.
 */
declare module "*?url" {
  const url: string;
  export default url;
}
