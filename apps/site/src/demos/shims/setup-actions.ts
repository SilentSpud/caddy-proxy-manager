/**
 * Stands in for the setup screens' server actions - `app/setup/actions.ts` and
 * `app/setup/migrate/actions.ts` both resolve here (see the plugin in astro.config.mjs).
 *
 * The real ones write the database and `redirect()`; these hand the form to the running setup
 * simulation, which does the same to its own state and loads the next page.
 */
import { currentSimulation } from "../setup-simulation";

export type SetupActionState = { error: string | null };

const noSimulation = { error: "There is no controller behind the documentation site." };

export async function createFirstAdmin(
  _previous: SetupActionState,
  formData: FormData,
): Promise<SetupActionState> {
  return currentSimulation()?.createFirstAdmin(formData) ?? noSimulation;
}

export async function configureFirstOAuthProvider(
  _previous: SetupActionState,
  formData: FormData,
): Promise<SetupActionState> {
  return currentSimulation()?.configureFirstOAuthProvider(formData) ?? noSimulation;
}

export async function skipMigration(): Promise<void> {
  await currentSimulation()?.skipMigration();
}
