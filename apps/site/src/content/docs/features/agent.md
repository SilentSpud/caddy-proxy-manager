---
title: The agent
description: How Caddy hosts are managed — pairing, the event stream, fleets, and what only the agent can do.
---

The agent runs beside Caddy on each host. It exists because the controller has no Docker socket,
and some things need the Caddy *container* recreated rather than its configuration reloaded.

## Why it is a separate container

Two things are fixed when a container is created and cannot be changed by reloading config:

- **Published ports**, which [L4 hosts](../l4-proxy/) need.
- **Compiled-in plugins**, which [Caddy Build](../caddy-build/) changes.

The agent also starts and stops the optional containers — ClickHouse for [analytics](../analytics/),
`geoipupdate` for [geo blocking](../geo-blocking/) — so those become toggles in Settings rather than
compose profiles you edit by hand.

## The agent dials out

The controller never connects to the agent. The agent connects out and holds an event stream open,
and the controller pushes work down it. A Caddy host can therefore sit behind NAT with no inbound
port and no port forwarding.

If the controller is unreachable, the agent retries with backoff and keeps Caddy serving whatever it
already had. Only a 401 — the controller having forgotten this agent — ends the loop.

## Same host

The bundled compose file runs an agent beside the controller. It pairs itself using a token both
containers can read from a shared volume, so there is nothing to enter. Reach the dashboard on port
3000 to finish setup and Caddy starts on its own.

## A different host

An agent elsewhere cannot read that volume, so it pairs with a code you carry. Generate one under
**Settings → Agents** — six letters, valid five minutes, single use, refused after ten wrong
guesses — then run on the agent's host:

```bash
docker exec caddy-proxy-manager-agent cpm-agent --pair --host 10.0.0.5 --code ABCDEF
```

The two exchange a secret, stored encrypted on both sides, and the code is never used again.
`CONTROLLER_URL` and `PAIRING_CODE` do the same without a terminal.

## Fleets

Any number of Caddy hosts can serve one configuration. Every apply lands on all of them or none,
and names the host that refused — a partial apply would leave two hosts disagreeing about what the
proxy is, which is worse than a failed one.

Hosts can also be pinned to specific agents, so one machine serves a subset rather than everything.

## Unpairing

Unpairing revokes the secret. The agent's next call is refused, it drops back to idle, and **it
stops Caddy** — so unpairing takes that host out of service. Pair it again with a fresh code to
bring it back.
