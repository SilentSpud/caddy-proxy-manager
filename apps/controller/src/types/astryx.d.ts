/**
 * Astryx variant augmentations owned by this app.
 *
 * The design system keeps these unions open on purpose: `ButtonVariant` is `keyof
 * ButtonVariantMap`, so augmenting the interface widens the prop. The augmentation must name the
 * component's own subpath - `astryx theme build` and the core's own guards look for the literal
 * interface there, and a map re-exported from the package root is invisible to both.
 *
 * A variant declared here is only half of it: the styling lives in src/app/astryx-variants.css,
 * which targets the `data-variant` attribute the component reflects. Adding a name here without
 * that rule type-checks, renders, and paints nothing.
 */
// Makes this file a module, so the block below augments `@astryxdesign/core/Button` instead of
// declaring a new ambient module that shadows it - which type-checks here and breaks every
// `import {Button}` in the app.
export {};

declare module "@astryxdesign/core/Button" {
  interface ButtonVariantMap {
    /**
     * The accent at a lower weight: the pink ground under pink text, where `primary` is the solid
     * fill. For a control that outranks `secondary` on a surface whose solid accent is already
     * spoken for - the primary SSO provider beside a form whose submit is the accent.
     */
    tonal: true;
  }
}
