/**
 * Stands in for `next/navigation` inside the demos (see the alias in astro.config.mjs).
 *
 * Only DataTable imports it. That table sorts and pages by pushing a new URL, because in the app
 * the server does the sorting — so for the demo to be more than a picture, the query string has to
 * be somewhere a component can both write and watch. It writes to the real one, and the demo that
 * owns the rows subscribes here and re-derives them, which is the same contract with the work
 * moved into the browser.
 *
 * `replaceState`, never `pushState`: a reader pressing Back should leave the page, not undo a sort.
 */
import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}

function navigate(href: string) {
  history.replaceState(null, "", href);
  for (const listener of listeners) listener();
}

// Both snapshots start empty so the server's HTML and the browser's first render agree; a demo
// linked to with a query string already set settles on it in the effect that follows.
const emptySnapshot = () => "";

export function usePathname(): string {
  return useSyncExternalStore(subscribe, () => location.pathname, emptySnapshot);
}

/** Reactive, unlike Next's: writing through `useRouter` re-renders everyone reading this. */
export function useSearchParams(): URLSearchParams {
  return new URLSearchParams(useSyncExternalStore(subscribe, () => location.search, emptySnapshot));
}

export function useRouter() {
  return {
    push: navigate,
    replace: navigate,
    refresh() {},
    back() {},
    forward() {},
    prefetch() {},
  };
}
