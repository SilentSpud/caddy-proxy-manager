// Version catalog for the Caddy build. Nothing here is compiled as a Go program: docker/caddy/
// build.sh reads these pins with `go list -m` and turns them into `xcaddy build --with path@version`
// flags, so a rebuild a month from now produces the same binary and go.sum authenticates each
// module. Which of them are compiled in is a separate question, answered at build time by
// CADDY_MODULES (Settings -> Caddy Build). Every module in src/lib/caddy-modules.ts must appear
// here — tests/unit/caddy-modules.test.ts asserts that.
//
// Never `go mod tidy` this file: no Go source imports these modules, so tidy would empty it.
//
// xcaddy itself is deliberately absent — it comes from the caddy:<version>-builder image the
// Dockerfile pins, not from here, so there is only one place its version lives.

module github.com/fuomag9/caddy-proxy-manager/docker/caddy

go 1.26.0

require (
	github.com/caddy-dns/acmedns v0.7.0
	github.com/caddy-dns/cloudflare v0.2.4
	github.com/caddy-dns/desec v1.1.0
	github.com/caddy-dns/digitalocean v0.0.0-20250606074528-04bde2867106
	github.com/caddy-dns/duckdns v0.5.0
	github.com/caddy-dns/dynu v1.0.0
	github.com/caddy-dns/godaddy v1.2.0
	github.com/caddy-dns/hetzner v1.0.0
	github.com/caddy-dns/infomaniak v1.0.2
	github.com/caddy-dns/ionos v1.2.0
	github.com/caddy-dns/linode v0.8.0
	github.com/caddy-dns/namecheap v1.0.0
	github.com/caddy-dns/njalla v1.0.0
	github.com/caddy-dns/ovh v1.1.0
	github.com/caddy-dns/porkbun v0.3.1
	github.com/caddy-dns/route53 v1.6.2
	github.com/caddy-dns/spaceship v1.0.0
	github.com/caddy-dns/vultr v0.0.0-20250723121531-55bf3e9768be
	github.com/caddyserver/caddy/v2 v2.11.4
	github.com/corazawaf/coraza-caddy/v2 v2.5.0
	github.com/fuomag9/caddy-blocker-plugin v0.0.0-20260728192246-a1ff7050deb7
	github.com/google/cel-go v0.29.0
	github.com/mholt/caddy-l4 v0.1.2
)

// caddy-blocker-plugin tracks Caddy master and wants cel-go v0.29.0, whose InterpretableV2 API
// Caddy v2.11.4 does not compile against. update-compatibility-pins.sh derives this from the
// pinned Caddy release, and Dependabot cannot move it without the image build passing.
// The import path becomes cel.dev/cel-go at v0.32.0, so a bump past v0.31.0 changes both sides.
replace github.com/google/cel-go => github.com/google/cel-go v0.28.1
