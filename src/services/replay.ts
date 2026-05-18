import type { Config } from "../config.js";
import type { Logger } from "../lib/logger.js";
import type { Metrics } from "../lib/metrics.js";
import { MAX_REPLAY_AGE_DAYS } from "../contract/types.js";
import type { ClickStore } from "./clicks.js";
import type { RoutyClient } from "./routyClient.js";
import { RoutyTransportError } from "./routyClient.js";

const TERMINAL_REJECTIONS = new Set([
  "duplicate",
  "link_not_found",
  "domain_not_found",
  "too_old",
  "clock_skew",
]);

export class ReplayWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly cfg: Config,
    private readonly clicks: ClickStore,
    private readonly routy: RoutyClient,
    private readonly log: Logger,
    private readonly metrics: Metrics
  ) {}

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => void this.tick(), this.cfg.replayIntervalMs);
    this.log.info({ intervalMs: this.cfg.replayIntervalMs }, "replay worker started");
  }

  async stop(): Promise<void> {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // Wait briefly for an in-flight tick to settle.
    for (let i = 0; i < 30 && this.running; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const batch = await this.clicks.pickReplayBatch(this.cfg.replayBatchSize);
      if (batch.length === 0) {
        const { backlog } = await this.clicks.backlogStats();
        this.metrics.replayBacklog.set(backlog);
        return;
      }

      // Edge-side enforcement of §5.3 limits — handle locally so we don't
      // burn round trips on clicks Routy will reject as too_old anyway.
      const cutoff = Date.now() - MAX_REPLAY_AGE_DAYS * 86_400_000;
      const tooOld = batch.filter((c) => new Date(c.occurredAt).getTime() < cutoff);
      const fresh = batch.filter((c) => new Date(c.occurredAt).getTime() >= cutoff);

      for (const c of tooOld) {
        await this.clicks.markRejectedTerminal(c.edgeClickId, "too_old");
        this.log.warn({ edgeClickId: c.edgeClickId }, "replay click expired locally");
      }
      if (fresh.length === 0) return;

      const resp = await this.routy.replay(fresh);
      const deleteAfter = this.cfg.clickLogMode === "none";
      for (const r of resp.results) {
        if (r.status === "accepted") {
          await this.clicks.markAccepted(r.edgeClickId, r.routyClickId, deleteAfter);
        } else if (TERMINAL_REJECTIONS.has(r.reason)) {
          await this.clicks.markRejectedTerminal(r.edgeClickId, r.reason);
        }
        // non-terminal rejections (`quota_exceeded`, `temporary`, unknown) stay
        // in the queue with needs_replay=true for the next tick.
      }

      const { backlog } = await this.clicks.backlogStats();
      this.metrics.replayBacklog.set(backlog);
    } catch (err) {
      if (err instanceof RoutyTransportError) {
        this.log.warn({ cause: err.cause }, "replay tick failed; will retry");
      } else {
        this.log.error({ err }, "replay tick error");
      }
    } finally {
      this.running = false;
    }
  }
}
