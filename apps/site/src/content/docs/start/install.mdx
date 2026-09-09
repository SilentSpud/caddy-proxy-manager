---
title: Install
description: Running Caddy Proxy Manager with Docker Compose.
sidebar:
  order: 2
---

One compose file and one `.env`.

```bash
git clone https://github.com/SilentSpud/caddy-proxy-manager.git
cd caddy-proxy-manager
cp .env.example .env
```

## Fill in the two required values

`.env.example` documents everything, but only two lines have no default:

```bash
# Unique per instance. Generate with: openssl rand -base64 32
SESSION_SECRET=

# The bundled PostgreSQL, or your own server
POSTGRES_PASSWORD=
```

`SESSION_SECRET` encrypts the secrets in the database. Changing it later makes every stored
credential unreadable, so generate it once and keep it.

## Start it

```bash
docker compose up -d
```

The dashboard is on port 3000. Caddy itself does not start yet — it sits behind a compose profile
and the agent starts it once the two are paired, which happens during [first run](../first-run/).
An unpaired host answering 80 and 443 with a default page would be worse than one not listening at
all.

## Ports

| Port | What |
| ---- | ---- |
| 3000 | The dashboard and API. Published so you always have a way in |
| 80 / 443 | Caddy, once it is running |
| 2019 | Caddy's admin API. **Internal only** — publishing it hands over your proxy |

## Upgrading

```bash
docker compose pull
docker compose up -d
```

Settings reports when a newer release is published to the registry you pull from. That check is the
only request the app makes to the internet on its own, and it can be switched off.
