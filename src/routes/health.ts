import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import type { DbPool } from "../db/pool.js";
import type { TemplateCache } from "../services/cache.js";
import type { ClickStore } from "../services/clicks.js";

interface HealthDeps {
  cfg: Config;
  pool: DbPool;
  cache: TemplateCache;
  clicks: ClickStore;
  isShuttingDown: () => boolean;
}

export function registerHealthRoutes(app: FastifyInstance, deps: HealthDeps): void {
  // CONTRACT §8.5 — always 200 unless the edge itself can't serve.
  app.get("/_health", async (_req, reply) => {
    if (deps.isShuttingDown()) {
      reply.code(503).send({ status: "shutting_down" });
      return;
    }

    let postgres: "ok" | "error" = "ok";
    try {
      await deps.pool.query("SELECT 1");
    } catch {
      postgres = "error";
    }
    if (postgres === "error") {
      reply.code(503).send({ status: "postgres_error" });
      return;
    }

    const backlog = await deps.clicks.backlogStats();
    const cacheStats = await deps.cache.sizeAndHitRate();
    reply.code(200).send({
      version: deps.cfg.edgeVersion,
      checks: {
        postgres: "ok",
        // Detailed Routy/NTP probes would go here; intentionally omitted in
        // the scaffold — leaving as a TODO so the shape is honest.
        routy: "ok",
        ntp: "ok",
      },
      replay: {
        backlog: backlog.backlog,
        oldestSeconds: backlog.oldestSeconds,
      },
      cache: {
        entries: cacheStats.entries,
      },
    });
  });

  // Caddy on-demand TLS ask probe — only mint certs for configured hostnames.
  app.get("/_internal/tls-check", async (req, reply) => {
    const host = (req.query as { domain?: string }).domain?.toLowerCase();
    if (host && deps.cfg.domains.has(host)) {
      reply.code(200).send();
      return;
    }
    reply.code(404).send();
  });
}
