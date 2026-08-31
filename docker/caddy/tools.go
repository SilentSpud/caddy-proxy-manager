//go:build tools

// This module is a version-pinning manifest for the Caddy build; it contains
// no compiled code. Without at least one Go file and these blank imports,
// `go mod tidy` (run by Dependabot on every update) treats every requirement
// as unused and strips the entire require block from go.mod. Keep every
// module listed in build.sh imported here so tidy preserves the pins.
//
// github.com/google/cel-go is intentionally absent: it has no root package
// and is already pulled in transitively by Caddy. Its compatibility version
// is managed through the replace directive in go.mod.

package tools

import (
	_ "github.com/caddy-dns/acmedns"
	_ "github.com/caddy-dns/cloudflare"
	_ "github.com/caddy-dns/desec"
	_ "github.com/caddy-dns/digitalocean"
	_ "github.com/caddy-dns/duckdns"
	_ "github.com/caddy-dns/dynu"
	_ "github.com/caddy-dns/godaddy"
	_ "github.com/caddy-dns/hetzner"
	_ "github.com/caddy-dns/infomaniak"
	_ "github.com/caddy-dns/ionos"
	_ "github.com/caddy-dns/linode"
	_ "github.com/caddy-dns/namecheap"
	_ "github.com/caddy-dns/njalla"
	_ "github.com/caddy-dns/ovh"
	_ "github.com/caddy-dns/porkbun"
	_ "github.com/caddy-dns/route53"
	_ "github.com/caddy-dns/spaceship"
	_ "github.com/caddy-dns/vultr"
	_ "github.com/caddyserver/caddy/v2"
	_ "github.com/caddyserver/xcaddy/cmd/xcaddy"
	_ "github.com/corazawaf/coraza-caddy/v2"
	_ "github.com/fuomag9/caddy-blocker-plugin"
	_ "github.com/mholt/caddy-l4"
)
