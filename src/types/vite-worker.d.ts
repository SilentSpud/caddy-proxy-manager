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
