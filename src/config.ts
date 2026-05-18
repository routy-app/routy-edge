import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf8")
) as { version: string };

export type ClickLogMode = "all" | "failed" | "none";

export interface Config {
  routyBaseUrl: string;
  routyApiKey: string;
  domains: Set<string>;
  clickLogMode: ClickLogMode;
  cacheTtlSeconds: number;
  fallbackTimeoutMs: number;
  replayBatchSize: number;
  replayIntervalMs: number;
  databaseUrl: string;
  port: number;
  logLevel: string;
  edgeVersion: string;
  edgeClientHeader: string;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function intEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) throw new Error(`Env var ${name} is not an integer: ${v}`);
  return n;
}

function modeEnv(name: string, fallback: ClickLogMode): ClickLogMode {
  const v = (process.env[name] ?? fallback).toLowerCase();
  if (v !== "all" && v !== "failed" && v !== "none") {
    throw new Error(`Env var ${name} must be one of all|failed|none (got ${v})`);
  }
  return v;
}

export function loadConfig(): Config {
  const version = pkg.version;
  const domains = new Set(
    required("DOMAINS")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
  return {
    routyBaseUrl: required("ROUTY_BASE_URL").replace(/\/$/, ""),
    routyApiKey: required("ROUTY_API_KEY"),
    domains,
    clickLogMode: modeEnv("CLICK_LOG_MODE", "failed"),
    cacheTtlSeconds: intEnv("CACHE_TTL_SECONDS", 3600),
    fallbackTimeoutMs: intEnv("FALLBACK_TIMEOUT_MS", 800),
    replayBatchSize: intEnv("REPLAY_BATCH_SIZE", 500),
    replayIntervalMs: intEnv("REPLAY_INTERVAL_MS", 30_000),
    databaseUrl: required("DATABASE_URL"),
    port: intEnv("PORT", 8080),
    logLevel: process.env.LOG_LEVEL ?? "info",
    edgeVersion: version,
    edgeClientHeader: `routy-edge/${version} (node${process.versions.node.split(".")[0]})`,
  };
}
