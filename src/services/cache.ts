import type { DbPool } from "../db/pool.js";
import type { RedirectMode } from "../contract/types.js";

export interface CachedTemplate {
  templateUrl: string;
  renderMode: RedirectMode;
  trackerValue: string | null;
  ageSeconds: number;
}

export class TemplateCache {
  constructor(private readonly pool: DbPool) {}

  async get(host: string, slug: string): Promise<CachedTemplate | null> {
    const { rows } = await this.pool.query<{
      template_url: string;
      render_mode: string;
      tracker_value: string | null;
      ttl_seconds: number;
      age_seconds: number;
    }>(
      `SELECT template_url, render_mode, tracker_value, ttl_seconds,
              EXTRACT(EPOCH FROM (now() - fetched_at))::int AS age_seconds
       FROM link_cache
       WHERE host = $1 AND slug = $2
         AND fetched_at + (ttl_seconds || ' seconds')::interval > now()`,
      [host, slug]
    );
    const row = rows[0];
    if (!row) return null;
    return {
      templateUrl: row.template_url,
      renderMode: row.render_mode as RedirectMode,
      trackerValue: row.tracker_value,
      ageSeconds: row.age_seconds,
    };
  }

  // Returns the cache entry regardless of TTL — used as a last resort during a
  // long outage where stale-but-present beats a 503 to the visitor.
  async getStale(host: string, slug: string): Promise<CachedTemplate | null> {
    const { rows } = await this.pool.query<{
      template_url: string;
      render_mode: string;
      tracker_value: string | null;
      age_seconds: number;
    }>(
      `SELECT template_url, render_mode, tracker_value,
              EXTRACT(EPOCH FROM (now() - fetched_at))::int AS age_seconds
       FROM link_cache
       WHERE host = $1 AND slug = $2`,
      [host, slug]
    );
    const row = rows[0];
    if (!row) return null;
    return {
      templateUrl: row.template_url,
      renderMode: row.render_mode as RedirectMode,
      trackerValue: row.tracker_value,
      ageSeconds: row.age_seconds,
    };
  }

  async set(
    host: string,
    slug: string,
    templateUrl: string,
    renderMode: RedirectMode,
    trackerValue: string | null,
    ttlSeconds: number
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO link_cache (host, slug, template_url, render_mode, tracker_value, ttl_seconds, fetched_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (host, slug) DO UPDATE SET
         template_url = EXCLUDED.template_url,
         render_mode = EXCLUDED.render_mode,
         tracker_value = EXCLUDED.tracker_value,
         ttl_seconds = EXCLUDED.ttl_seconds,
         fetched_at = now()`,
      [host, slug, templateUrl, renderMode, trackerValue, ttlSeconds]
    );
  }

  async sizeAndHitRate(): Promise<{ entries: number }> {
    const { rows } = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM link_cache`
    );
    return { entries: Number(rows[0]?.count ?? "0") };
  }
}
