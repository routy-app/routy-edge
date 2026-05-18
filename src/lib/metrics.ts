import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";

export class Metrics {
  readonly registry = new Registry();
  readonly requestsTotal: Counter<"mode" | "status">;
  readonly upstreamLatency: Histogram<"outcome">;
  readonly fallbackTotal: Counter<"reason">;
  readonly cacheHitTotal: Counter<"hit">;
  readonly replayBacklog: Gauge<string>;
  readonly clicksLogged: Counter<"mode">;

  constructor() {
    collectDefaultMetrics({ register: this.registry });
    this.requestsTotal = new Counter({
      name: "edge_requests_total",
      help: "Total visitor requests handled",
      labelNames: ["mode", "status"],
      registers: [this.registry],
    });
    this.upstreamLatency = new Histogram({
      name: "edge_upstream_latency_seconds",
      help: "Latency of pr=v1 calls to Routy",
      labelNames: ["outcome"],
      buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 1, 2, 5],
      registers: [this.registry],
    });
    this.fallbackTotal = new Counter({
      name: "edge_fallback_total",
      help: "Times the edge served from cache instead of Routy",
      labelNames: ["reason"],
      registers: [this.registry],
    });
    this.cacheHitTotal = new Counter({
      name: "edge_cache_total",
      help: "Cache lookups",
      labelNames: ["hit"],
      registers: [this.registry],
    });
    this.replayBacklog = new Gauge({
      name: "edge_replay_backlog",
      help: "Queued fallback clicks waiting to be replayed",
      registers: [this.registry],
    });
    this.clicksLogged = new Counter({
      name: "edge_clicks_logged_total",
      help: "Click rows written locally",
      labelNames: ["mode"],
      registers: [this.registry],
    });
  }
}
