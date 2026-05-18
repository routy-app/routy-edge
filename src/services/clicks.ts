import type { DbPool } from "../db/pool.js";
import type { ClickLogMode } from "../config.js";
import type { RedirectMode, ReplayClick } from "../contract/types.js";

export interface LiveClickInput {
  routyClickId: string;
  host: string;
  slug: string;
  cid: string | null;
  redirectMode: RedirectMode;
  renderedUrl: string;
  ip: string | null;
  userAgent: string | null;
  referrer: string | null;
}

export interface FallbackClickInput {
  edgeClickId: string;
  host: string;
  slug: string;
  cid: string | null;
  redirectMode: RedirectMode;
  renderedUrl: string;
  templateUrl: string;
  queryString: string;
  ip: string | null;
  userAgent: string | null;
  referrer: string | null;
}

export class ClickStore {
  constructor(
    private readonly pool: DbPool,
    private readonly mode: ClickLogMode
  ) {}

  async logLive(input: LiveClickInput): Promise<void> {
    if (this.mode !== "all") return;
    await this.pool.query(
      `INSERT INTO clicks (
        edge_click_id, occurred_at, mode, redirect_mode,
        host, slug, cid, query_string, ip, user_agent, referrer,
        rendered_url, template_url, needs_replay, routy_click_id
      ) VALUES ($1, now(), 'live', $2, $3, $4, $5, '', $6, $7, $8, $9, NULL, FALSE, $10)
      ON CONFLICT (edge_click_id) DO NOTHING`,
      [
        input.routyClickId,
        input.redirectMode,
        input.host,
        input.slug,
        input.cid,
        input.ip,
        input.userAgent,
        input.referrer,
        input.renderedUrl,
        input.routyClickId,
      ]
    );
  }

  // Fallback clicks are ALWAYS persisted (regardless of mode) — replay needs them.
  // CLICK_LOG_MODE controls whether they're kept after a successful replay.
  async logFallback(input: FallbackClickInput): Promise<void> {
    await this.pool.query(
      `INSERT INTO clicks (
        edge_click_id, occurred_at, mode, redirect_mode,
        host, slug, cid, query_string, ip, user_agent, referrer,
        rendered_url, template_url, needs_replay, replay_status
      ) VALUES ($1, now(), 'fallback', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, TRUE, 'pending')
      ON CONFLICT (edge_click_id) DO NOTHING`,
      [
        input.edgeClickId,
        input.redirectMode,
        input.host,
        input.slug,
        input.cid,
        input.queryString,
        input.ip,
        input.userAgent,
        input.referrer,
        input.renderedUrl,
        input.templateUrl,
      ]
    );
  }

  async pickReplayBatch(limit: number): Promise<ReplayClick[]> {
    const { rows } = await this.pool.query<{
      edge_click_id: string;
      occurred_at: Date;
      host: string;
      slug: string;
      cid: string | null;
      query_string: string;
      ip: string | null;
      user_agent: string | null;
      referrer: string | null;
      rendered_url: string;
      template_url: string | null;
    }>(
      `UPDATE clicks
       SET attempts = attempts + 1, last_attempt_at = now()
       WHERE edge_click_id IN (
         SELECT edge_click_id FROM clicks
         WHERE needs_replay = TRUE
           AND replay_status IS DISTINCT FROM 'accepted'
           AND replay_status IS DISTINCT FROM 'rejected_terminal'
         ORDER BY occurred_at ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING edge_click_id, occurred_at, host, slug, cid, query_string,
                 ip, user_agent, referrer, rendered_url, template_url`,
      [limit]
    );

    return rows.map((r) => ({
      edgeClickId: r.edge_click_id,
      occurredAt: r.occurred_at.toISOString(),
      host: r.host,
      slug: r.slug,
      cid: r.cid,
      queryString: r.query_string,
      ip: r.ip,
      userAgent: r.user_agent,
      referrer: r.referrer,
      renderedTargetUrl: r.rendered_url,
      templateUrl: r.template_url ?? "",
    }));
  }

  async markAccepted(
    edgeClickId: string,
    routyClickId: string,
    deleteAfter: boolean
  ): Promise<void> {
    if (deleteAfter) {
      await this.pool.query(`DELETE FROM clicks WHERE edge_click_id = $1`, [edgeClickId]);
      return;
    }
    await this.pool.query(
      `UPDATE clicks
       SET needs_replay = FALSE, replay_status = 'accepted', routy_click_id = $2
       WHERE edge_click_id = $1`,
      [edgeClickId, routyClickId]
    );
  }

  async markRejectedTerminal(edgeClickId: string, reason: string): Promise<void> {
    await this.pool.query(
      `UPDATE clicks
       SET needs_replay = FALSE, replay_status = 'rejected_terminal',
           routy_click_id = NULL,
           query_string = COALESCE(query_string, '') || ' [rejected:' || $2 || ']'
       WHERE edge_click_id = $1`,
      [edgeClickId, reason]
    );
  }

  async backlogStats(): Promise<{ backlog: number; oldestSeconds: number | null }> {
    const { rows } = await this.pool.query<{
      backlog: string;
      oldest_seconds: number | null;
    }>(
      `SELECT COUNT(*)::text AS backlog,
              EXTRACT(EPOCH FROM (now() - MIN(occurred_at)))::int AS oldest_seconds
       FROM clicks
       WHERE needs_replay = TRUE
         AND replay_status IS DISTINCT FROM 'accepted'
         AND replay_status IS DISTINCT FROM 'rejected_terminal'`
    );
    const row = rows[0];
    return {
      backlog: Number(row?.backlog ?? "0"),
      oldestSeconds: row?.oldest_seconds ?? null,
    };
  }
}
