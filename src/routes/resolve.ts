import { randomUUID } from "node:crypto";
import type {
  FastifyBaseLogger,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import type { Config } from "../config.js";
import type { Metrics } from "../lib/metrics.js";
import type { TemplateCache } from "../services/cache.js";
import type { ClickStore } from "../services/clicks.js";
import type { RoutyClient } from "../services/routyClient.js";
import { RoutyTransportError } from "../services/routyClient.js";
import {
  newEdgeClickId,
  newDynamicParam,
  renderTemplate,
  TemplateRenderError,
} from "../services/render.js";
import { cloakedHtml } from "../services/cloaked.js";
import type {
  RedirectMode,
  ResolveResponse,
  ResolveResponseError,
} from "../contract/types.js";

interface ResolveDeps {
  cfg: Config;
  log: FastifyBaseLogger;
  metrics: Metrics;
  cache: TemplateCache;
  clicks: ClickStore;
  routy: RoutyClient;
}

// Headers visible to Routy verbatim for fraud / device signal (CONTRACT §4.1).
const FORWARD_HEADERS = [
  "user-agent",
  "accept-language",
  "accept-encoding",
  "referer",
  "sec-ch-ua",
  "sec-ch-ua-mobile",
  "sec-ch-ua-platform",
  "sec-fetch-mode",
  "sec-fetch-site",
  "sec-fetch-dest",
  "sec-fetch-user",
  "dnt",
] as const;

export function registerResolveRoutes(app: FastifyInstance, deps: ResolveDeps): void {
  // §4.5: HEAD / OPTIONS short-circuit. Never hit Routy.
  app.route({
    method: ["HEAD"],
    url: "/*",
    handler: async (_req, reply) => {
      reply.header("Cache-Control", "no-store").code(200).send();
    },
  });

  app.route({
    method: ["OPTIONS"],
    url: "/*",
    handler: async (_req, reply) => {
      reply.code(204).send();
    },
  });

  app.get("/*", async (req, reply) => handleResolve(req, reply, deps));
}

async function handleResolve(
  req: FastifyRequest,
  reply: FastifyReply,
  deps: ResolveDeps
): Promise<void> {
  const host = pickHost(req);
  if (!host || !deps.cfg.domains.has(host)) {
    deps.metrics.requestsTotal.inc({ mode: "live", status: "unknown_domain" });
    reply.code(404).send({ error: "unknown_domain" });
    return;
  }

  const { pathname, search } = parseUrl(req.url);
  const slug = stripLeadingSlash(pathname);
  const queryString = search.startsWith("?") ? search.slice(1) : search;
  if (!slug) {
    reply.code(404).send({ error: "no_slug" });
    return;
  }

  const idempotencyKey = randomUUID();
  const clientIp = pickClientIp(req);
  const proto = pickProto(req);
  const port = pickPort(req);

  let resp: ResolveResponse;
  const stop = deps.metrics.upstreamLatency.startTimer();
  try {
    resp = await deps.routy.resolve({
      host,
      slug,
      queryString,
      idempotencyKey,
      visitorHeaders: pickVisitorHeaders(req),
      clientIp,
      proto,
      port,
    });
    stop({ outcome: "ok" });
  } catch (err) {
    stop({ outcome: err instanceof RoutyTransportError ? err.cause : "unknown" });
    await serveFallback(req, reply, deps, host, slug, queryString, clientIp, err);
    return;
  }

  if (resp.status === "error") {
    deps.metrics.requestsTotal.inc({ mode: "live", status: `err_${resp.error.code}` });
    serveError(reply, resp);
    return;
  }

  await deps.cache.set(
    host,
    slug,
    resp.redirect.templateUrl,
    resp.redirect.mode,
    resp.redirect.placeholders.tracker,
    resp.cache.ttlSeconds
  );
  deps.metrics.cacheHitTotal.inc({ hit: "refreshed" });

  await deps.clicks.logLive({
    routyClickId: resp.click.id,
    host,
    slug,
    cid: resp.click.cid,
    redirectMode: resp.redirect.mode,
    renderedUrl: resp.redirect.renderedUrl,
    ip: clientIp,
    userAgent: req.headers["user-agent"] ?? null,
    referrer: (req.headers.referer as string | undefined) ?? null,
  });
  if (deps.cfg.clickLogMode === "all") {
    deps.metrics.clicksLogged.inc({ mode: "live" });
  }
  deps.metrics.requestsTotal.inc({ mode: "live", status: "ok" });
  serveRedirect(reply, resp.redirect.mode, resp.redirect.renderedUrl);
}

async function serveFallback(
  req: FastifyRequest,
  reply: FastifyReply,
  deps: ResolveDeps,
  host: string,
  slug: string,
  queryString: string,
  clientIp: string | null,
  err: unknown
): Promise<void> {
  const reason =
    err instanceof RoutyTransportError ? err.cause : "unknown";
  deps.metrics.fallbackTotal.inc({ reason });

  const cached =
    (await deps.cache.get(host, slug)) ?? (await deps.cache.getStale(host, slug));
  if (!cached) {
    deps.metrics.cacheHitTotal.inc({ hit: "miss" });
    deps.metrics.requestsTotal.inc({ mode: "fallback", status: "unavailable" });
    deps.log.warn({ host, slug, reason }, "fallback miss; serving 503");
    reply.code(503).header("Retry-After", "30").send({ error: "unavailable" });
    return;
  }
  deps.metrics.cacheHitTotal.inc({ hit: cached.ageSeconds === 0 ? "fresh" : "stale" });

  const edgeClickId = newEdgeClickId();
  let renderedUrl: string;
  try {
    renderedUrl = renderTemplate({
      templateUrl: cached.templateUrl,
      clickId: edgeClickId,
      dynamic: newDynamicParam(),
      tracker: cached.trackerValue,
      forwardedQueryString: queryString,
    });
  } catch (renderErr) {
    if (renderErr instanceof TemplateRenderError) {
      deps.metrics.requestsTotal.inc({ mode: "fallback", status: "render_error" });
      deps.log.error({ host, slug, err: renderErr.message }, "template render failed");
      reply.code(503).header("Retry-After", "30").send({ error: "render_failed" });
      return;
    }
    throw renderErr;
  }

  await deps.clicks.logFallback({
    edgeClickId,
    host,
    slug,
    cid: extractCid(queryString),
    redirectMode: cached.renderMode,
    renderedUrl,
    templateUrl: cached.templateUrl,
    queryString,
    ip: clientIp,
    userAgent: req.headers["user-agent"] ?? null,
    referrer: (req.headers.referer as string | undefined) ?? null,
  });
  deps.metrics.clicksLogged.inc({ mode: "fallback" });
  deps.metrics.requestsTotal.inc({ mode: "fallback", status: "ok" });

  serveRedirect(reply, cached.renderMode, renderedUrl);
}

function serveRedirect(reply: FastifyReply, mode: RedirectMode, url: string): void {
  if (mode === "cloaked") {
    reply
      .code(200)
      .header("Content-Type", "text/html; charset=utf-8")
      .header("Referrer-Policy", "no-referrer")
      .header("Cache-Control", "no-store")
      .send(cloakedHtml(url));
    return;
  }
  reply.redirect(url, 302);
}

function serveError(reply: FastifyReply, resp: ResolveResponseError): void {
  if (resp.error.responseBody !== null) {
    reply.code(resp.error.httpStatus).send(resp.error.responseBody);
    return;
  }
  reply.code(resp.error.httpStatus).send({
    error: resp.error.code,
    message: resp.error.message,
  });
}

function pickHost(req: FastifyRequest): string | null {
  const xfh = (req.headers["x-forwarded-host"] as string | undefined)?.split(",")[0]?.trim();
  const host = (xfh ?? req.headers.host ?? "").split(":")[0]?.toLowerCase() ?? null;
  return host || null;
}

function pickProto(req: FastifyRequest): string {
  const xfp = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim();
  return (xfp ?? req.protocol ?? "https").toLowerCase();
}

function pickPort(req: FastifyRequest): string | null {
  const xfpo = (req.headers["x-forwarded-port"] as string | undefined)?.split(",")[0]?.trim();
  return xfpo ?? null;
}

function pickClientIp(req: FastifyRequest): string | null {
  const xff = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim();
  return xff ?? req.ip ?? null;
}

function pickVisitorHeaders(req: FastifyRequest): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of FORWARD_HEADERS) {
    const v = req.headers[name];
    if (typeof v === "string" && v.length > 0) {
      // Capitalize first letter of each segment to follow common HTTP casing.
      out[canonicalHeader(name)] = v;
    }
  }
  return out;
}

function canonicalHeader(name: string): string {
  return name
    .split("-")
    .map((s) => (s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1)))
    .join("-");
}

function parseUrl(rawUrl: string): { pathname: string; search: string } {
  const qIdx = rawUrl.indexOf("?");
  if (qIdx === -1) return { pathname: rawUrl, search: "" };
  return { pathname: rawUrl.slice(0, qIdx), search: rawUrl.slice(qIdx) };
}

function stripLeadingSlash(p: string): string {
  return p.startsWith("/") ? p.slice(1) : p;
}

function extractCid(queryString: string): string | null {
  if (queryString.length === 0) return null;
  const params = new URLSearchParams(queryString);
  return params.get("cid");
}
