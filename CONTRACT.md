# `pr=v1` — Routy Edge Proxy Contract

This document defines the wire contract between [`routy-edge`](https://github.com/routy-app/routy-edge) (self-hosted) and the Routy `/route` endpoint (SaaS). It is a **public, versioned API**. Any self-hosted proxy pinned to `pr=v1` MUST continue to work for the lifetime of `v1`.

If you fork `routy-edge` or implement your own client, this is the document you implement against.

---

## 1. Versioning

- The contract version is carried as a query parameter: `?pr=v1`.
- Breaking changes ship as a new version (`pr=v2`). They never modify `v1` in place.
- When a version is deprecated, Routy responds with the `X-Routy-Deprecation` header on every response (a date and a migration URL). The version remains functional for **at least 12 months** after the deprecation header first appears.
- Additive, backward-compatible changes within a version are allowed (new optional fields, new optional headers). Clients MUST ignore unknown JSON fields.

---

## 2. Endpoints

| Method | Path           | Purpose                                           |
|--------|----------------|---------------------------------------------------|
| `GET`  | `/route`       | Resolve a redirect (replaces the visitor request) |
| `POST` | `/route/replay`| Replay clicks queued during a fallback window     |

Base URL is configured per-tenant (typically `https://route.<your-region>.routy.io`).

---

## 3. Authentication

All `pr=v1` requests MUST include:

```
X-Routy-Edge-Auth: <shared-secret>
```

The secret is provisioned per-tenant from the Routy dashboard. It scopes the proxy to a single Routy account — Routy will reject `pr=v1` requests for any domain not owned by the authenticated account.

Without the header (or with an invalid one), Routy returns `401 Unauthorized` and does **not** fall through to normal redirect behavior — so a misconfigured proxy fails loud rather than silently leaking link metadata.

> **v2 note:** v2 will upgrade to HMAC-signed timestamps to prevent replay. v1 stays simple bearer.

---

## 4. Resolve: `GET /route?pr=v1`

### 4.1 Request

#### Query params

| Param         | Required | Description                                                                 |
|---------------|----------|-----------------------------------------------------------------------------|
| `pr`          | yes      | Contract version. Must be `v1`.                                              |
| (link params) | yes      | Whatever your Routy link expects — slug, sub-IDs, etc. Passed through as-is. |
| `cid`         | no       | Caller-provided click ID. Routy stores it alongside its own click ID for join. |

**Reserved names:** `pr` and `cid` are reserved by this contract. If a customer link template uses one of those names natively, the contract value wins — the customer MUST rename their own parameter. Document this in any onboarding so no one ships `?pr=newsletter`.

#### Trust-conditional headers (proxy-aware)

The edge MUST set these to reflect the visitor's actual ingress. Routy trusts them **only** when `X-Routy-Edge-Auth` validates; without a valid secret, Routy ignores forwarded fields and uses the TCP peer instead. This is what stops a misconfigured or malicious caller from spoofing IPs.

| Header                | Edge rule                                                                                            |
|-----------------------|------------------------------------------------------------------------------------------------------|
| `X-Forwarded-For`     | **Overwrite**, do not append. Set to the visitor's TCP peer IP. Existing values from the visitor are untrusted and dropped. |
| `X-Forwarded-Host`    | **Overwrite** with the host the visitor actually hit (one of your edge domains).                       |
| `X-Forwarded-Proto`   | **Overwrite** with `http` or `https` based on the visitor's TLS state.                                  |
| `X-Forwarded-Port`    | **Overwrite** with the port the visitor connected to.                                                  |

#### Visitor headers forwarded verbatim (fraud / device signal)

Routy's bot-quality, device, and OS detection reads more than IP and UA. The edge MUST forward these headers from the visitor verbatim, in original order where possible. Stripping or reordering them silently degrades fraud filtering and device attribution.

| Header             | Used by Routy for                          |
|--------------------|--------------------------------------------|
| `User-Agent`       | Device / OS / browser parsing               |
| `Accept-Language`  | Geo & language attribution, bot signal      |
| `Accept-Encoding`  | Bot signal                                  |
| `Referer`          | Source attribution                          |
| `Sec-CH-UA`        | Client Hints — high-entropy device signal   |
| `Sec-CH-UA-Mobile` | Device class                                |
| `Sec-CH-UA-Platform`| OS                                         |
| `Sec-Fetch-*`      | Request context (bot signal)                |
| `DNT`              | Privacy signal                              |

Everything else SHOULD be stripped to avoid leaking unintended visitor headers to Routy.

> **Note on `User-Agent`:** This is the *visitor's* UA, not the edge's. Routy parses it for device/OS. The edge identifies itself in a separate header below.

#### Edge-identifying headers

| Header                | Required | Purpose                                                                                  |
|-----------------------|----------|------------------------------------------------------------------------------------------|
| `X-Routy-Edge-Auth`   | yes      | Shared secret (see §3).                                                                  |
| `X-Routy-Edge-Client` | yes      | Edge identity, e.g. `routy-edge/1.2.3 (node20)`. Used for fleet visibility / deprecation comms. **Does NOT replace `User-Agent`.** |
| `Idempotency-Key`     | no, but SHOULD | Per-visitor-request UUID. Edge reuses the same key on retry within a single visitor request. Routy dedups within a 5-minute window so a network blip never double-counts a click. |

### 4.2 Response

Always `200 OK` at the HTTP layer if the request reached Routy and parsed correctly. Business outcome lives in the JSON body's `status` field. (This lets the edge proxy distinguish "Routy is up but the link is dead" from "Routy is unreachable" — only the latter triggers fallback.)

```jsonc
{
  "version": "v1",
  "status": "ok",                    // "ok" | "error"

  "redirect": {
    "mode": "302",                   // "302" | "cloaked"
    "templateUrl": "https://example.com/lp?clickid=[clickid]&sub=[dynamic]",
    "renderedUrl":  "https://example.com/lp?clickid=AB12CD34&sub=XYZ789",
    "placeholders": {
      "clickId":  "AB12CD34",
      "dynamic":  "XYZ789",
      "tracker":  null
    }
  },

  "click": {
    "id": "01HXYZ...",               // Routy's canonical click ID
    "brandLinkId": "abc",
    "accountId": "acct_123",
    "affiliateDomain": {
      "id": "dom_456",
      "host": "mail.acme.com",
      "trafficSourceId": "src_789"
    },
    "cid": "ext-abc-123"             // echoed from request, or null
  },

  "cache": {
    "ttlSeconds": 3600,              // edge SHOULD respect; MAY use shorter
    "key": "mail.acme.com:abc"       // advisory cache key
  },

  "error": null
}
```

**Field semantics:**

- `redirect.mode`
  - `"302"` — serve a normal HTTP 302 to `renderedUrl`.
  - `"cloaked"` — serve an HTML response with `<meta name="referrer" content="no-referrer">` and a meta-refresh to `renderedUrl`. Reference HTML in [§7](#7-cloaked-render-reference).
- `redirect.templateUrl` — pre-substitution template. Cache this for fallback. Contains placeholders: `[clickid]`, `[dynamic]`, `[tracker]`.
- `redirect.renderedUrl` — fully substituted for *this* request, with Routy's click ID. **On the happy path the edge SHOULD serve this verbatim** so Routy's click ID is the one stored. Only render locally when falling back.
- `redirect.placeholders.tracker` — current tracker value for this `(account, affiliateDomain)`. `null` if not applicable. Edge stores this with the template for use during fallback.
- `cache.ttlSeconds` — Routy-driven TTL. Edge MAY cap it lower; MUST NOT exceed it.

### 4.3 Error responses

`status: "error"` means Routy resolved the request but the link is unservable.

```jsonc
{
  "version": "v1",
  "status": "error",
  "redirect": null,
  "click": null,
  "cache": null,
  "error": {
    "code": "LINK_DISABLED",
    "message": "Link is disabled",
    "httpStatus": 410,
    "responseBody": null            // if non-null, edge serves this verbatim
  }
}
```

Defined error codes:

| `code`              | `httpStatus` | Meaning                                          |
|---------------------|--------------|--------------------------------------------------|
| `LINK_NOT_FOUND`    | 404          | No link matches the slug on this domain          |
| `LINK_DISABLED`     | 410          | Link exists but is currently disabled            |
| `DOMAIN_NOT_FOUND`  | 404          | Host not configured under this Routy account     |
| `QUOTA_EXCEEDED`    | 429          | Account/link quota tripped                       |
| `INVALID_REQUEST`   | 400          | Required parameter missing or malformed          |

The edge proxy maps `httpStatus` straight to the visitor response. New error codes may be added; clients MUST treat unknown codes as `httpStatus: 500`.

### 4.4 Transport-layer errors

If the HTTP call itself fails (timeout, DNS, 5xx, TLS error), the edge proxy enters **fallback mode**:

1. Look up `templateUrl` + `placeholders.tracker` from local cache, keyed on `(host, slug)`.
2. If found and not expired: render locally (see [§6](#6-local-render-rules)), serve, queue the click for replay.
3. If not found or expired: serve `503 Service Unavailable` with a configurable retry-after.

A response with `status: "error"` is **not** a transport-layer error — the edge serves it as-is, no fallback.

### 4.5 HEAD / OPTIONS requests

Link previewers (Slack, iMessage, Outlook Safe Links, security scanners) fire `HEAD` and `OPTIONS` before any real visitor click. If the edge forwards these to Routy, your click counts include every paste in every chat app.

| Method     | Edge behavior                                                                                                     |
|------------|-------------------------------------------------------------------------------------------------------------------|
| `HEAD`     | Edge handles locally. Respond `200 OK` with empty body and `Cache-Control: no-store`. MUST NOT call Routy.        |
| `OPTIONS`  | Edge handles locally. Respond `204 No Content` with the configured CORS headers (if any). MUST NOT call Routy.    |
| `GET`      | Normal resolve flow (§4.1–4.4).                                                                                    |
| other      | `405 Method Not Allowed`. MUST NOT call Routy.                                                                     |

### 4.6 Rate limiting

If the edge is sending more than its provisioned rate, Routy responds:

```
HTTP/1.1 429 Too Many Requests
Retry-After: 30
X-Routy-RateLimit-Limit: 100
X-Routy-RateLimit-Remaining: 0
X-Routy-RateLimit-Reset: 1716035400

{
  "version": "v1",
  "status": "error",
  "error": {
    "code": "RATE_LIMITED",
    "message": "Edge rate limit exceeded",
    "httpStatus": 429,
    "responseBody": null,
    "retryAfterSeconds": 30
  }
}
```

**Edge MUST treat `429` from Routy the same as a transport error** — fall back to cached template, queue the click for replay, and surface a normal redirect to the visitor. **A visitor MUST NEVER see a 429 caused by Routy throttling the edge.** That's an operational signal, not a visitor signal.

---

## 5. Replay: `POST /route/replay?pr=v1`

After a fallback window, the edge proxy pushes queued clicks back to Routy.

### 5.1 Request

```jsonc
POST /route/replay?pr=v1
Content-Type: application/json
X-Routy-Edge-Auth: <shared-secret>

{
  "clicks": [
    {
      "edgeClickId": "edge_01HXYZ...",     // edge-generated, used for idempotency
      "occurredAt": "2026-05-18T10:14:22.117Z",
      "host": "mail.acme.com",
      "slug": "abc",
      "cid": "ext-abc-123",                 // or null
      "queryString": "utm_source=newsletter",
      "ip": "203.0.113.42",
      "userAgent": "Mozilla/5.0 ...",
      "referrer": null,
      "renderedTargetUrl": "https://example.com/lp?clickid=edge_01HXYZ...&sub=NANOID",
      "templateUrl": "https://example.com/lp?clickid=[clickid]&sub=[dynamic]"
    }
  ]
}
```

Batch size: up to 1,000 per request. Larger queues are paged.

### 5.2 Response

```jsonc
{
  "version": "v1",
  "results": [
    {
      "edgeClickId": "edge_01HXYZ...",
      "status": "accepted",
      "routyClickId": "01HXYZ..."
    },
    {
      "edgeClickId": "edge_01HABC...",
      "status": "rejected",
      "reason": "duplicate"               // already replayed
    },
    {
      "edgeClickId": "edge_01HDEF...",
      "status": "rejected",
      "reason": "link_not_found"
    }
  ]
}
```

**Idempotency:** `edgeClickId` is the dedup key on Routy's side. Replay is safe to retry indefinitely — duplicates return `rejected/duplicate`, not an error. Edge proxies SHOULD only delete a queued click from the local table on `accepted` or `rejected/<terminal-reason>`. Transport errors → keep, retry.

**Rejected reasons:**

| `reason`            | Terminal? | Edge action                                     |
|---------------------|-----------|-------------------------------------------------|
| `duplicate`         | yes       | Delete from queue                               |
| `link_not_found`    | yes       | Delete from queue, log                          |
| `domain_not_found`  | yes       | Delete from queue, log                          |
| `too_old`           | yes       | Delete from queue, log + metric (`replay_too_old_total`) |
| `clock_skew`        | yes       | Delete from queue, log loudly + metric. Fix NTP. |
| `quota_exceeded`    | no        | Keep, retry later (e.g. next replay window)     |
| `temporary`         | no        | Keep, retry                                     |

### 5.3 Timing rules

`occurredAt` is what Routy uses for attribution bucketing (which day, hour, campaign window a click belongs to). A wrong clock silently corrupts attribution, so the contract is strict:

| Rule                  | Value                                                                                            |
|-----------------------|--------------------------------------------------------------------------------------------------|
| **Max replay age**    | 7 days. `occurredAt` older than `now - 7d` → `rejected/too_old`.                                  |
| **Max clock skew**    | ±5 minutes vs Routy server time. `occurredAt` more than 5min in the future → `rejected/clock_skew`. |
| **NTP requirement**   | Edge MUST run NTP. The reference docker-compose ships with `chrony` or equivalent.                |
| **Timestamp format**  | RFC 3339 / ISO 8601 with millisecond precision and explicit timezone (always `Z` recommended).    |

Routy returns its current server time in the `Date` response header on every `pr=v1` call. Edge SHOULD compare against this on startup and on each replay batch — a drift > 60 seconds SHOULD be logged as a warning even before it hits the 5-minute hard limit.

---

## 6. Local render rules

When the edge proxy renders locally (fallback path), it substitutes placeholders in `templateUrl`:

| Placeholder    | Substitution                                                                                       |
|----------------|---------------------------------------------------------------------------------------------------|
| `[clickid]`    | Edge-generated 18-char alphanumeric ID, **prefixed `edge_`** for traceability. E.g. `edge_AB12...` |
| `[dynamic]`    | Edge-generated 18-char alphanumeric (nanoid alphabet: uppercase + digits)                          |
| `[tracker]`    | Cached `placeholders.tracker`. If `null` and template contains `[tracker]`, fail with 503.        |

After placeholder substitution, forwarded query params (those not consumed by Routy) are appended unchanged.

The locally-rendered URL is what gets served to the visitor AND what gets sent in the replay payload as `renderedTargetUrl`.

---

## 7. Cloaked render reference

For `redirect.mode == "cloaked"`, the edge proxy serves:

```http
HTTP/1.1 200 OK
Content-Type: text/html; charset=utf-8
Referrer-Policy: no-referrer
Cache-Control: no-store

<!DOCTYPE html>
<html>
  <head>
    <meta name="referrer" content="no-referrer" />
    <meta http-equiv="refresh" content="0;URL='{RENDERED_URL}'" />
  </head>
  <body></body>
</html>
```

`{RENDERED_URL}` MUST be HTML-attribute-escaped. This is identical to Routy's own cloaked render (see `RedirectResponseWriter.WriteActionResult`).

---

## 8. Response headers

| Header                          | When                | Purpose                                                |
|---------------------------------|---------------------|--------------------------------------------------------|
| `Date`                          | always              | RFC 7231 server time. Edge uses this for clock-skew detection. |
| `X-Routy-Version`               | always              | Always `v1` for this contract.                         |
| `X-Routy-Request-Id`            | always              | Trace ID — include in support tickets.                  |
| `X-Routy-Deprecation`           | only when deprecated | `<sunset-date>; <migration-url>`.                       |
| `X-Routy-Cache-Hint`            | optional            | Server's suggested cache TTL in seconds (mirrors body). |
| `Retry-After`                   | only on `429`       | Seconds until the edge may retry.                      |
| `X-Routy-RateLimit-Limit`       | only on `429`       | Configured per-minute limit for this tenant.           |
| `X-Routy-RateLimit-Remaining`   | only on `429`       | Always `0` on a 429 response.                          |
| `X-Routy-RateLimit-Reset`       | only on `429`       | Unix timestamp when the window resets.                 |

---

## 8.5 Edge health check

Not part of the wire contract with Routy, but spec'd here so all `routy-edge` implementations (and forks) expose a consistent shape. Operators rely on this for monitoring.

```
GET /_health
```

Response (always `200 OK`, even when degraded — see below):

```jsonc
{
  "version": "1.2.3",
  "checks": {
    "postgres": "ok",                              // "ok" | "error"
    "routy":    "ok",                              // "ok" | "degraded" | "unreachable"
    "ntp":      "ok"                               // "ok" | "skew_warning" | "skew_error"
  },
  "replay": {
    "backlog": 0,                                  // queued clicks awaiting replay
    "oldestSeconds": null                          // age of oldest queued click, null if backlog == 0
  },
  "cache": {
    "entries": 124,
    "hitRate1m": 0.97
  }
}
```

**Status semantics — why always `200`:**

The endpoint returns `200` even when `routy: unreachable`, because the *whole point* of the edge proxy is to keep serving when Routy is down. Failing the health check during a Routy outage would make orchestrators kill perfectly-functional edge pods exactly when they're most needed.

Only return non-`200` when the edge itself cannot serve traffic:

| Condition                          | Status |
|------------------------------------|--------|
| Postgres unreachable               | `503`  |
| Process is shutting down (SIGTERM) | `503`  |
| Otherwise                          | `200`  |

---

## 9. Examples

### 9.1 Happy path

**Request**
```
GET /route?pr=v1&slug=summer-sale&cid=mc_8821 HTTP/1.1
Host: route.routy.io
X-Routy-Edge-Auth: sk_edge_live_xxx
X-Routy-Edge-Client: routy-edge/1.2.3 (node20)
Idempotency-Key: 9b2f1c84-...
X-Forwarded-For: 203.0.113.42
X-Forwarded-Host: mail.acme.com
X-Forwarded-Proto: https
User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) ...
Accept-Language: en-US,en;q=0.9
Sec-CH-UA-Platform: "iOS"
Sec-CH-UA-Mobile: ?1
Referer: https://mail.acme.com/newsletter/may-2026
```

**Response**
```jsonc
HTTP/1.1 200 OK
Content-Type: application/json
X-Routy-Version: v1
X-Routy-Request-Id: req_01HXYZ...

{
  "version": "v1",
  "status": "ok",
  "redirect": {
    "mode": "302",
    "templateUrl": "https://shop.example.com/?clickid=[clickid]",
    "renderedUrl":  "https://shop.example.com/?clickid=01HXYZAB",
    "placeholders": { "clickId": "01HXYZAB", "dynamic": "NANOID18CHARLONG", "tracker": null }
  },
  "click": {
    "id": "01HXYZAB",
    "brandLinkId": "lnk_summer",
    "accountId": "acct_acme",
    "affiliateDomain": { "id": "dom_mail", "host": "mail.acme.com", "trafficSourceId": "src_email" },
    "cid": "mc_8821"
  },
  "cache": { "ttlSeconds": 3600, "key": "mail.acme.com:summer-sale" },
  "error": null
}
```

Edge action: serve `302` to `renderedUrl`, refresh cache for `mail.acme.com:summer-sale`.

### 9.2 Cloaked link

Same shape as 9.1 but with `"mode": "cloaked"`. Edge serves the HTML from §7.

### 9.3 Link disabled

```jsonc
{
  "version": "v1",
  "status": "error",
  "redirect": null,
  "click": null,
  "cache": null,
  "error": {
    "code": "LINK_DISABLED",
    "message": "This link has been disabled by the account owner",
    "httpStatus": 410,
    "responseBody": null
  }
}
```

Edge action: serve `410 Gone`. No fallback.

### 9.4 Fallback (Routy unreachable)

Routy times out. Edge looks up the template for `(mail.acme.com, summer-sale)`, finds:
- `templateUrl`: `https://shop.example.com/?clickid=[clickid]`
- `placeholders.tracker`: `null`
- `cache.ttlSeconds` not yet expired

Edge generates `clickId = edge_NEWID18CHARSXX`, renders `https://shop.example.com/?clickid=edge_NEWID18CHARSXX`, serves `302`, writes a row to the local `clicks` table.

When Routy recovers, edge POSTs the queued click to `/route/replay?pr=v1` and gets back `{ status: "accepted", routyClickId: "01HABC..." }`. The edge row is updated with `routyClickId` (for join) and removed from the replay queue.

---

## 10. Stability guarantees

For `pr=v1`:

- No field will be removed.
- No field's type will change.
- No field's semantics will change.
- No required header will be made optional or vice versa.
- The list of reserved query params (currently `pr`, `cid`) will only grow, never shrink.
- New optional fields may be added — clients MUST ignore unknown fields.
- New optional headers may be added (request or response) — clients MUST ignore unknown response headers.
- New `error.code` values may be added — clients MUST treat unknown codes as a generic 500.
- New `rejected.reason` values may be added — clients MUST treat unknown reasons as `temporary` (keep & retry). Note: edges MUST still enforce their own max-replay-age (§5.3) so a `temporary` interpretation never loops indefinitely on what would have been a `too_old`/`clock_skew` rejection.

If we need to change any of the above, it ships as `pr=v2`.
