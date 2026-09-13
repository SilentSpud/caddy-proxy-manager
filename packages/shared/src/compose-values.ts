/**
 * The shapes of desired-state values that end up in a compose file or a `docker` child's
 * environment.
 *
 * Defined here so the controller that produces them and the agent that consumes them test against
 * one definition. The agent re-checks every value itself: it holds the Docker socket, and a
 * controller that is compromised, or anyone on-path to it, must not be able to widen what a frame
 * can do by sending something the controller would never have produced.
 */

/**
 * Go module paths land verbatim in a shell command in the Caddy Dockerfile, so an allowlist, not
 * escaping.
 */
export const MODULE_PATH_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._~/-]*[a-zA-Z0-9]$/;
export const MODULE_VERSION_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._+-]*$/;
export const MODULE_PATH_MAX_LENGTH = 200;

/** Whether a string is a module path the Caddy build accepts. Expects it already normalized. */
export function isValidModulePath(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= MODULE_PATH_MAX_LENGTH &&
    MODULE_PATH_PATTERN.test(path) &&
    path.includes("/")
  );
}

/** Whether a string is an xcaddy `--with` spec: a module path, optionally `@version`. */
export function isValidModuleSpec(spec: string): boolean {
  const at = spec.indexOf("@");
  if (at === -1) return isValidModulePath(spec);
  return isValidModulePath(spec.slice(0, at)) && MODULE_VERSION_PATTERN.test(spec.slice(at + 1));
}

/** `HOST:CONTAINER[/proto]`, the compose short form the controller and `docker inspect` produce. */
const L4_PORT_PATTERN = /^(\d{1,5}):(\d{1,5})(?:\/(?:tcp|udp))?$/;

export function isValidL4PortMapping(mapping: string): boolean {
  const match = L4_PORT_PATTERN.exec(mapping);
  if (!match) return false;
  return [match[1], match[2]].every((part) => {
    const port = Number(part);
    return port >= 1 && port <= 65535;
  });
}
