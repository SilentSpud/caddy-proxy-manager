//go:build tools

// The version catalog in go.mod only survives `go mod tidy` because these blank imports exist:
// tidy drops every requirement no package imports, and without this file that is all of them.
// Dependabot runs tidy as part of preparing an update, so a bump would otherwise arrive as a PR
// that empties go.mod and go.sum instead of moving one line.
//
// The `tools` build tag is never enabled for a real build, so nothing here is ever compiled --
// xcaddy generates its own main package from build.sh's --with flags. Tidy, however, reads files
// under every build tag, which is exactly the asymmetry this relies on.
//
// One import per module in the catalog. Adding a module to src/lib/caddy-modules.ts means adding
// it in go.mod and here; tests/unit/caddy-modules.test.ts catches the go.mod half.

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
	_ "github.com/corazawaf/coraza-caddy/v2"
	_ "github.com/fuomag9/caddy-blocker-plugin"
	_ "github.com/mholt/caddy-l4"

	// cel-go has no package at its module root; the replace directive in go.mod is what this
	// import is here to keep alive.
	_ "github.com/google/cel-go/cel"
)
