# routy-edge

[![CI](https://github.com/routy-app/routy-edge/actions/workflows/ci.yml/badge.svg)](https://github.com/routy-app/routy-edge/actions/workflows/ci.yml)
[![GHCR](https://img.shields.io/badge/ghcr.io-routy--app%2Frouty--edge-blue?logo=github)](https://github.com/routy-app/routy-edge/pkgs/container/routy-edge)

> Self-hosted edge proxy for [Routy](https://routy.io) redirect links. Run it on your own infrastructure, on your own domains. A Routy outage never costs you a click — and your domain reputation stays on *your* domain, not a shared one.

---

## Why

**Domain protection.** If you run email, your sender reputation is everything. Putting your tracking redirects behind a domain you own (and isolated infra) keeps blacklist blast radius on *you* — not on a shared Routy domain that other tenants also use.

**Edge resilience.** Any channel that pays per click — push, SMS, paid social, native — eats the cost the moment a click 502s. routy-edge serves redirects locally from cache when Routy is slow or unreachable, and queues the click for replay. You never drop a click.

**Audit & control.** Optional local click log on your own Postgres. The repo is MIT — fork it, audit it, change it, run it. PRs welcome.

---

## How it works

```
                  ┌─────────────────────────────────────────────┐
                  │  YOUR INFRASTRUCTURE (one tiny VM is plenty)│
                  │                                             │
visitor ──► your-domain.com ──► Caddy ──► routy-edge ──► cache  │
                  │                           │      (Postgres) │
                  │                           ▼                 │
                  │                       click log             │
                  └───────────────────────────┬─────────────────┘
                                              │  pr=v1 (HTTPS, signed)
                                              ▼
                                      Routy /route (SaaS)
```

**Happy path:** request hits routy-edge → calls Routy with `?pr=v1` → Routy returns the link template + render mode in JSON → routy-edge caches the template, renders the per-click URL locally, serves the redirect, logs the click.

**Fallback path:** Routy unreachable or slow → routy-edge renders from the cached template (its own clickId, dynamic param, parameter forwarding), serves the redirect, queues the click for replay when Routy comes back.

---

## Quick start

```bash
git clone https://github.com/routy-app/routy-edge.git
cd routy-edge
cp .env.example .env   # set ROUTY_API_KEY and DOMAINS
docker compose up -d   # pulls routyapp/routy-edge:latest from Docker Hub
```

No build step needed — `docker compose` pulls the pre-built image straight from the [GitHub Container Registry](https://github.com/routy-app/routy-edge/pkgs/container/routy-edge). The `Dockerfile` is included only for forks who want to modify and rebuild.

Point your domain's A record at the box. Caddy fetches TLS on first request via Let's Encrypt on-demand. You're live.

### Pinning a version

`:latest` tracks the most recent published release. For production, pin to an exact version:

```bash
EDGE_IMAGE=ghcr.io/routy-app/routy-edge:0.1.0 docker compose up -d
```

Available tags: `latest`, semver (`0.1.0`, `0.1`, `0`). Images are built for `linux/amd64` and `linux/arm64`.

---

## Configuration

All via env vars. Full list in `.env.example`; the ones you'll actually touch:

| Variable               | Required | Default | Description                                              |
|------------------------|----------|---------|----------------------------------------------------------|
| `ROUTY_BASE_URL`       | yes      | —       | e.g. `https://route.routy.io`                             |
| `ROUTY_API_KEY`        | yes      | —       | Shared secret for the `pr=v1` contract                    |
| `DOMAINS`              | yes      | —       | Comma-separated list, e.g. `mail.acme.com,promo.acme.com` |
| `CLICK_LOG_MODE`       | no       | `failed`| `all` · `failed` · `none`                                  |
| `CACHE_TTL_SECONDS`    | no       | `3600`  | How long a cached template stays fresh                    |
| `FALLBACK_TIMEOUT_MS`  | no       | `800`   | Trip into fallback if Routy takes longer than this        |
| `REPLAY_BATCH_SIZE`    | no       | `500`   | Click-replay batch size on recovery                        |

---

## Multi-domain catch-all

One routy-edge instance handles any number of domains. Add them to `DOMAINS` (or use a wildcard), point the A records at the box, and Caddy + Let's Encrypt do the TLS automatically on first request.

The cache is keyed on `(host, slug)` — the same Routy brand link can live on multiple of your domains with different tracker/traffic-source settings, and they won't cross-contaminate.

---

## Click logging

The local Postgres `clicks` table is an **operational mirror** — it's for *your* audit, debugging, and outage replay. It is **not** the source of truth for billing or analytics; Routy's records are authoritative.

| Mode    | What gets stored locally                                          |
|---------|-------------------------------------------------------------------|
| `none`  | Nothing — pure proxy.                                              |
| `failed`| Only clicks served from fallback (i.e. while Routy was unreachable). Recommended default. |
| `all`   | Every click. Useful for debugging or if you want an independent audit log. |

Replay: on Routy recovery, queued fallback clicks are forwarded over the same `pr=v1` channel. Clicks carry the locally-generated clickId so replay is idempotent and there's no double-counting.

---

## Cloaked links

Routy supports cloaked links (no-referrer, meta-refresh render). The `pr=v1` response carries the render mode, so routy-edge honors cloaking on both the live path and the fallback path — your cloaked links stay cloaked even during an outage.

---

## Passing your own click ID

If you already mint a click ID upstream (your ESP, CRM, ad platform), pass it as `?cid=<your-id>`. routy-edge forwards it to Routy, which stores it alongside its own click ID for cross-system join.

---

## API contract: `pr=v1`

routy-edge talks to Routy over a versioned, signed JSON contract — see [CONTRACT.md](./CONTRACT.md) for the full schema. The version is part of the query string (`pr=v1`) so older self-hosted proxies keep working when Routy adds new versions. Breaking changes ship as `pr=v2` with deprecation notice on `v1`.

Auth is a shared secret (`X-Routy-Edge-Auth` header derived from `ROUTY_API_KEY`). Without it, Routy won't serve `pr=v1` responses.

---

## Operations

- **Stack:** Node 20 + TypeScript, Fastify, Postgres 16. Caddy in front for TLS. That's it.
- **Cache table:** Postgres `UNLOGGED` table — skips WAL, fast writes, lost on crash (which is fine for a cache).
- **Health check:** `GET /_health` returns 200 if Postgres is reachable. Routy reachability is reported but does not fail health (the whole point is to keep serving when Routy is down).
- **Metrics:** Prometheus endpoint at `/_metrics` — request count, p50/p95/p99, cache hit ratio, fallback ratio, replay backlog depth.
- **Logs:** structured JSON to stdout. Plug into whatever you already use.
- **Footprint:** ~80MB image, runs comfortably on a $5/month VM for normal volumes.

---

## Scaling

Single instance handles ~5k req/s on a 1 vCPU box (cache-hit path). For higher volume or HA, run multiple instances behind a load balancer with a shared Postgres — the cache table is safe for concurrent readers and writers.

---

## Contributing

PRs welcome. The codebase is small and intentionally boring — Fastify routes, a Postgres pool, a render module that mirrors Routy's link templating. If you want a feature, open an issue first so we can keep the `pr=v1` contract stable.

Forks are also a first-class use case. If you need this to do something we don't support, fork it. We just ask that you don't ship modified contract code under the same name.

### Development

```bash
npm ci
npm test          # node:test, no DB required for current suite
npm run typecheck
npm run dev       # tsx watch
```

### Releasing (maintainers)

The Docker Hub publish runs **only on `v*.*.*` tag pushes** — `main` pushes do not publish. To cut a release:

```bash
scripts/release.sh patch    # or minor / major / explicit X.Y.Z
git push origin main vX.Y.Z
```

The tag push triggers `.github/workflows/release.yml`, which builds multi-arch (`linux/amd64,linux/arm64`) and publishes `ghcr.io/routy-app/routy-edge:X.Y.Z`, `:X.Y`, `:X`, and `:latest`. Auth uses the built-in `GITHUB_TOKEN` — no secret setup needed.

> **One-time setup after the first release:** GitHub packages default to private. After the first tag push, go to the package page and flip visibility to public so the world can `docker pull` without auth.

See [CHANGELOG.md](./CHANGELOG.md).

---

## License

MIT.
