/**
 * The `--with` specs `docker/caddy/Dockerfile` compiles in when no build arg overrides it.
 *
 * Shared because both sides read an agent that has never rebuilt as carrying exactly this: the
 * controller when gating config, the agent when deciding whether a desired set needs a rebuild.
 * The controller's catalog and the Dockerfile's ARG default are both tested against this list.
 */
export const SHIPPED_CADDY_MODULES: readonly string[] = [
  "github.com/caddy-dns/cloudflare",
  "github.com/caddy-dns/route53",
  "github.com/caddy-dns/digitalocean",
  "github.com/caddy-dns/duckdns",
  "github.com/caddy-dns/hetzner",
  "github.com/caddy-dns/vultr",
  "github.com/caddy-dns/porkbun",
  "github.com/caddy-dns/godaddy",
  "github.com/caddy-dns/namecheap",
  "github.com/caddy-dns/netcup",
  "github.com/caddy-dns/ovh",
  "github.com/caddy-dns/ionos",
  "github.com/caddy-dns/linode",
  "github.com/caddy-dns/njalla",
  "github.com/caddy-dns/spaceship",
  "github.com/caddy-dns/desec",
  "github.com/caddy-dns/dynu",
  "github.com/caddy-dns/acmedns",
  "github.com/caddy-dns/infomaniak",
  "github.com/caddy-dns/cloudns",
  "github.com/mholt/caddy-l4",
  "github.com/tailscale/caddy-tailscale",
  "github.com/fuomag9/caddy-blocker-plugin",
  "github.com/corazawaf/coraza-caddy/v2",
];
