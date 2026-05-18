import type { DbPool } from "./pool.js";

// Idempotent bootstrap. Runs on every start; no migration framework needed
// while the schema fits on one screen.
export async function ensureSchema(pool: DbPool): Promise<void> {
  await pool.query(`
    CREATE UNLOGGED TABLE IF NOT EXISTS link_cache (
      host           TEXT NOT NULL,
      slug           TEXT NOT NULL,
      template_url   TEXT NOT NULL,
      render_mode    TEXT NOT NULL,
      tracker_value  TEXT,
      ttl_seconds    INTEGER NOT NULL,
      fetched_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (host, slug)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS clicks (
      edge_click_id     TEXT PRIMARY KEY,
      occurred_at       TIMESTAMPTZ NOT NULL,
      mode              TEXT NOT NULL,
      redirect_mode     TEXT NOT NULL,
      host              TEXT NOT NULL,
      slug              TEXT NOT NULL,
      cid               TEXT,
      query_string      TEXT NOT NULL DEFAULT '',
      ip                TEXT,
      user_agent        TEXT,
      referrer          TEXT,
      rendered_url      TEXT NOT NULL,
      template_url      TEXT,
      needs_replay      BOOLEAN NOT NULL DEFAULT FALSE,
      replay_status     TEXT,
      routy_click_id    TEXT,
      attempts          INTEGER NOT NULL DEFAULT 0,
      last_attempt_at   TIMESTAMPTZ,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_clicks_replay_pending
      ON clicks (occurred_at)
      WHERE needs_replay = TRUE AND replay_status IS DISTINCT FROM 'accepted';
  `);
}
