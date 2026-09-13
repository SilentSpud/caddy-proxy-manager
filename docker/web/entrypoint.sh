#!/bin/sh
set -e

# The compiled binary; it resolves the build output relative to its own location
# on disk, so it does not depend on the working directory.
exec /app/cpm-server
