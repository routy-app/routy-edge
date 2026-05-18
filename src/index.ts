import { loadConfig } from "./config.js";
import { makeLogger } from "./lib/logger.js";
import { Metrics } from "./lib/metrics.js";
import { makePool } from "./db/pool.js";
import { ensureSchema } from "./db/migrate.js";
import { buildServer } from "./server.js";
import { ReplayWorker } from "./services/replay.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const log = makeLogger(cfg.logLevel);
  const metrics = new Metrics();
  const pool = makePool(cfg.databaseUrl);

  await ensureSchema(pool);

  let shuttingDown = false;
  const { app, clicks, routy } = buildServer(cfg, metrics, pool, () => shuttingDown);
  const replay = new ReplayWorker(cfg, clicks, routy, log, metrics);

  await app.listen({ host: "0.0.0.0", port: cfg.port });
  replay.start();
  log.info(
    { port: cfg.port, domains: [...cfg.domains], version: cfg.edgeVersion },
    "routy-edge ready"
  );

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, "shutting down");
    try {
      await replay.stop();
      await app.close();
      await pool.end();
    } catch (err) {
      log.error({ err }, "shutdown error");
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("fatal startup error:", err);
  process.exit(1);
});
