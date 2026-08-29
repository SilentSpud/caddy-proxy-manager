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

// caddy-blocker-plugin tracks Caddy master and currently requests cel-go
// v0.29.0, whose InterpretableV2 API is incompatible with Caddy v2.11.4.
// Keep the reviewed stable Caddy build on its own cel-go version; the image
// build test must pass before Dependabot can merge an update to this pin.
replace github.com/google/cel-go => github.com/google/cel-go v0.28.1
