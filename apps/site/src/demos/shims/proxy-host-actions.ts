/**
 * Stands in for `app/(dashboard)/proxy-hosts/actions` inside the demos (see the alias in
 * astro.config.mjs).
 *
 * HostDialogs imports these, and the option fields the dashboard host demo renders live beside it,
 * so the module is reached without anything being submitted. Should a demo ever submit one, it
 * fails the way a save with no controller behind it would.
 */
import type { ActionState } from "@cpm/controller/src/lib/actions";

const refused: ActionState = {
  status: "error",
  message: "There is no controller behind the documentation site.",
};

export async function createProxyHostAction(
  _previous: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return refused;
}

export async function updateProxyHostAction(
  _id: number,
  _previous: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return refused;
}

export async function deleteProxyHostAction(
  _id: number,
  _previous: ActionState,
): Promise<ActionState> {
  return refused;
}

export async function toggleProxyHostAction(_id: number, _enabled: boolean): Promise<ActionState> {
  return refused;
}
