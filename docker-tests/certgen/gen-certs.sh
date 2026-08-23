#!/usr/bin/env bash
# Mints the fixed PKI the rig needs before anything else can start.
#
#   pebble-ca.*    a CA whose only job is to sign Pebble's ACME endpoint. Caddy
#                  is told to trust it via the acme.caRootPem setting, which is
#                  what makes ACME-over-HTTPS work with no public trust anchor.
#   pebble.*       Pebble's server certificate. Must be valid for the name Caddy
#                  dials (pebble) — Pebble's own bundled cert is localhost-only.
#   origin-tls.*   a self-signed cert for the HTTPS origin, issued for a name it
#                  is deliberately NOT reachable under, so upstream hostname
#                  verification fails unless a host opts out of it.
#
# Output lands in a named volume, so this is a no-op on repeat runs.
set -euo pipefail

CERT_DIR=/certs
DAYS=3650

if [ -s "$CERT_DIR/pebble.crt.pem" ] && [ -s "$CERT_DIR/origin-tls.crt.pem" ]; then
  echo "certgen: certificates already present in $CERT_DIR, nothing to do"
  exit 0
fi

mkdir -p "$CERT_DIR"
cd "$CERT_DIR"

echo "certgen: generating the ACME endpoint CA"
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout pebble-ca.key.pem -out pebble-ca.crt.pem \
  -days "$DAYS" -sha256 \
  -subj "/CN=CPM Docker Test Pebble CA" \
  -addext "basicConstraints=critical,CA:TRUE" \
  -addext "keyUsage=critical,keyCertSign,cRLSign" >/dev/null 2>&1

echo "certgen: generating the Pebble server certificate"
openssl req -newkey rsa:2048 -nodes \
  -keyout pebble.key.pem -out pebble.csr \
  -subj "/CN=pebble" >/dev/null 2>&1

cat > pebble.ext <<'EXT'
basicConstraints=CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:pebble,DNS:localhost,IP:172.28.0.30,IP:127.0.0.1
EXT

openssl x509 -req -in pebble.csr \
  -CA pebble-ca.crt.pem -CAkey pebble-ca.key.pem -CAcreateserial \
  -out pebble.crt.pem -days "$DAYS" -sha256 \
  -extfile pebble.ext >/dev/null 2>&1

echo "certgen: generating the intentionally-mismatched HTTPS origin certificate"
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout origin-tls.key.pem -out origin-tls.crt.pem \
  -days "$DAYS" -sha256 \
  -subj "/CN=not-the-origin-hostname.invalid" \
  -addext "subjectAltName=DNS:not-the-origin-hostname.invalid" >/dev/null 2>&1

rm -f pebble.csr pebble.ext

# Consumers run as assorted UIDs (Pebble as root, the origin as python's user).
# Nothing here is secret — it is a throwaway PKI on an isolated network.
chmod 0644 ./*.pem

echo "certgen: done"
ls -l "$CERT_DIR"
