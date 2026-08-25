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
	github.com/caddyserver/xcaddy v0.4.7
	github.com/corazawaf/coraza-caddy/v2 v2.5.0
	github.com/fuomag9/caddy-blocker-plugin v0.0.0-20260728192246-a1ff7050deb7
	github.com/google/cel-go v0.29.0
	github.com/mholt/caddy-l4 v0.1.2
)

// caddy-blocker-plugin tracks Caddy master and currently requests cel-go
// v0.29.0, whose InterpretableV2 API is incompatible with Caddy v2.11.4.
// Keep the reviewed stable Caddy build on its own cel-go version; the image
// build test must pass before Dependabot can merge an update to this pin.
replace github.com/google/cel-go => github.com/google/cel-go v0.28.1
