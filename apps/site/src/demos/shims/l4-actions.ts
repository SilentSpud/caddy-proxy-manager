/**
 * Stands in for `app/(dashboard)/l4-proxy-hosts/actions` inside the demos (see the alias in
 * astro.config.mjs).
 *
 * A save succeeds, which is what closes the editor, and what was posted is handed to whichever
 * demo is listening so it can show what the form sent - the part a reader cannot otherwise see.
 */
import type { ActionState } from "@cpm/controller/src/lib/actions";
import { t } from "../catalog";

export type SavedL4Host = { id: number | null; form: FormData };

const listeners = new Set<(saved: SavedL4Host) => void>();

/** Hear about every save until the returned function is called. */
export function onL4HostSaved(listener: (saved: SavedL4Host) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 500));

async function save(id: number | null, formData: FormData): Promise<ActionState> {
  await pause();
  for (const listener of listeners) listener({ id, form: formData });
  return {
    status: "success",
    message: t(id === null ? "l4ProxyHosts.hostCreated" : "l4ProxyHosts.hostUpdated"),
  };
}

export async function createL4ProxyHostAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return save(null, formData);
}

export async function updateL4ProxyHostAction(
  id: number,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return save(id, formData);
}

export async function deleteL4ProxyHostAction(
  _id: number,
  _previous: ActionState,
): Promise<ActionState> {
  await pause();
  return { status: "success" };
}

export async function toggleL4ProxyHostAction(
  _id: number,
  _enabled: boolean,
): Promise<ActionState> {
  return { status: "success" };
}
