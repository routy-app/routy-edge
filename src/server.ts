import Fastify, { type FastifyInstance } from "fastify";
import type { Config } from "./config.js";
import type { Metrics } from "./lib/metrics.js";
import type { DbPool } from "./db/pool.js";
import { TemplateCache } from "./services/cache.js";
import { ClickStore } from "./services/clicks.js";
import { RoutyClient } from "./services/routyClient.js";
import { registerResolveRoutes } from "./routes/resolve.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerMetricsRoute } from "./routes/metrics.js";

export interface Server {
  app: FastifyInstance;
  cache: TemplateCache;
  clicks: ClickStore;
  routy: RoutyClient;
}

export function buildServer(
  cfg: Config,
  metrics: Metrics,
  pool: DbPool,
  isShuttingDown: () => boolean
): Server {
  const app: FastifyInstance = Fastify({
    logger: {
      level: cfg.logLevel,
      base: { service: "routy-edge" },
    },
    trustProxy: true,
    disableRequestLogging: false,
  });

  const cache = new TemplateCache(pool);
  const clicks = new ClickStore(pool, cfg.clickLogMode);
  const routy = new RoutyClient(cfg);

  registerHealthRoutes(app, { cfg, pool, cache, clicks, isShuttingDown });
  registerMetricsRoute(app, metrics);
  registerResolveRoutes(app, { cfg, log: app.log, metrics, cache, clicks, routy });

  return { app, cache, clicks, routy };
}
