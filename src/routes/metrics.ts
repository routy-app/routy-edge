import type { FastifyInstance } from "fastify";
import type { Metrics } from "../lib/metrics.js";

export function registerMetricsRoute(app: FastifyInstance, metrics: Metrics): void {
  app.get("/_metrics", async (_req, reply) => {
    reply
      .header("Content-Type", metrics.registry.contentType)
      .send(await metrics.registry.metrics());
  });
}
