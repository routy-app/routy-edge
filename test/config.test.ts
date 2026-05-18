import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";

const REQUIRED = {
  ROUTY_BASE_URL: "https://route.routy.io/",
  ROUTY_API_KEY: "sk_test",
  DOMAINS: "MAIL.example.com, promo.example.com",
  DATABASE_URL: "postgres://x/y",
};

function withEnv<T>(overrides: Record<string, string | undefined>, fn: () => T): T {
  const saved = new Map<string, string | undefined>();
  for (const [k, v] of Object.entries(overrides)) {
    saved.set(k, process.env[k]);
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("loads with defaults applied", () => {
  withEnv({ ...REQUIRED, CLICK_LOG_MODE: undefined, CACHE_TTL_SECONDS: undefined }, () => {
    const cfg = loadConfig();
    assert.equal(cfg.clickLogMode, "failed");
    assert.equal(cfg.cacheTtlSeconds, 3600);
    assert.equal(cfg.fallbackTimeoutMs, 800);
    assert.equal(cfg.replayBatchSize, 500);
    assert.equal(cfg.port, 8080);
  });
});

test("strips trailing slash from base URL", () => {
  withEnv(REQUIRED, () => {
    const cfg = loadConfig();
    assert.equal(cfg.routyBaseUrl, "https://route.routy.io");
  });
});

test("lowercases and trims domains into a Set", () => {
  withEnv(REQUIRED, () => {
    const cfg = loadConfig();
    assert.ok(cfg.domains.has("mail.example.com"));
    assert.ok(cfg.domains.has("promo.example.com"));
    assert.equal(cfg.domains.size, 2);
  });
});

test("throws on missing required env", () => {
  withEnv({ ...REQUIRED, ROUTY_API_KEY: undefined }, () => {
    assert.throws(() => loadConfig(), /ROUTY_API_KEY/);
  });
});

test("throws on invalid CLICK_LOG_MODE", () => {
  withEnv({ ...REQUIRED, CLICK_LOG_MODE: "everything" }, () => {
    assert.throws(() => loadConfig(), /CLICK_LOG_MODE/);
  });
});

test("throws on non-integer int env", () => {
  withEnv({ ...REQUIRED, CACHE_TTL_SECONDS: "not-a-number" }, () => {
    assert.throws(() => loadConfig(), /CACHE_TTL_SECONDS/);
  });
});

test("edge client header includes version and node major", () => {
  withEnv(REQUIRED, () => {
    const cfg = loadConfig();
    assert.match(cfg.edgeClientHeader, /^routy-edge\/\d+\.\d+\.\d+ \(node\d+\)$/);
  });
});
