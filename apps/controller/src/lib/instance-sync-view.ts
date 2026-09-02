import type { EnvAgentInstance } from "./instance-sync";

export type EnvAgentInstanceView = Pick<EnvAgentInstance, "name" | "url">;

/**
 * Environment-configured sync tokens are server-only credentials. Keep the
 * browser payload as an explicit allowlist so new server-side fields cannot
 * start crossing the React Server Component boundary by accident.
 */
export function toEnvAgentInstanceView(instance: EnvAgentInstance): EnvAgentInstanceView {
  return {
    name: instance.name,
    url: instance.url,
  };
}
