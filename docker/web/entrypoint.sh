#!/bin/sh
set -e

DB_PATH="${DATABASE_PATH:-/app/data/caddy-proxy-manager.db}"
DB_DIR=$(dirname "$DB_PATH")

echo "Ensuring database directory exists..."
mkdir -p "$DB_DIR"

echo "Starting application..."
# The compiled binary; it resolves the build output relative to its own location
# on disk, so it does not depend on the working directory.
exec /app/cpm-server
