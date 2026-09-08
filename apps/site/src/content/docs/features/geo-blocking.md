---
title: Geo blocking
description: Block or allow by country, continent, ASN, CIDR or exact IP, per host, with allow rules taking precedence.
---

Geo blocking is configured per proxy host, and per [L4 host](../l4-proxy/). It needs MaxMind
GeoLite2 databases, which CPM can keep updated for you.

## Rule types

| Type | Example | What it matches |
| ---- | ------- | --------------- |
| Country | `DE` | ISO 3166-1 alpha-2 country code |
| Continent | `EU` | `AF`, `AN`, `AS`, `EU`, `NA`, `OC`, `SA` |
| ASN | `24940` | Autonomous System Number |
| CIDR | `91.98.150.0/24` | An IP range |
| IP | `91.98.150.103` | One exact address |

## Allow beats block

Rules are either **block** or **allow**, and allow rules take precedence. That ordering is what
makes the useful shape possible: block an entire continent, then allow the two ASNs or addresses
that should still get through.

## Fail-closed

If the GeoIP database cannot answer — it is missing, or the lookup fails — fail-closed mode rejects
the request rather than letting it past. Off by default, because the safer choice for most
deployments is that a broken database does not take the site down; on when the block list is a
security control rather than a nuisance filter.

## Responses

A blocked HTTP request gets a status code and body you choose. At layer 4 there is nothing to
answer with, so the connection is closed.

## Trusted proxies

If CPM sits behind another proxy, the client address it sees is that proxy's. **Settings → Trusted
Proxies** tells Caddy which addresses to trust and which header carries the real client IP, so geo
rules match the visitor rather than your load balancer. The global list can seed the per-host
geoblock trusted-proxy list, so the two cannot silently disagree.

## Getting the databases

1. Register for a free account at [maxmind.com](https://www.maxmind.com/).
2. Generate a licence key with `GeoLite2-Country` and `GeoLite2-ASN` permissions.
3. Open **Settings → GeoIP Databases**, tick **Use GeoIP**, and enter the account ID and key.

On a stack with an [agent](../agent/) that is the whole setup — saving starts the `geoipupdate`
container. Turning the toggle off stops it again and hides country matching from the host forms.
Without an agent, put the credentials in `.env` and start the compose profile by hand.
