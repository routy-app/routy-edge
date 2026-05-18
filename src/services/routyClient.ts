import type { Config } from "../config.js";
import type {
  ReplayClick,
  ReplayResponse,
  ResolveResponse,
} from "../contract/types.js";

export interface ResolveInput {
  host: string;
  slug: string;
  queryString: string;
  idempotencyKey: string;
  visitorHeaders: Record<string, string>;
  clientIp: string | null;
  proto: string;
  port: string | null;
}

export class RoutyTransportError extends Error {
  constructor(
    message: string,
    readonly cause: "timeout" | "network" | "http_5xx" | "http_429" | "bad_json"
  ) {
    super(message);
    this.name = "RoutyTransportError";
  }
}

export class RoutyClient {
  constructor(private readonly cfg: Config) {}

  async resolve(input: ResolveInput): Promise<ResolveResponse> {
    const url = this.buildResolveUrl(input);
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), this.cfg.fallbackTimeoutMs);
    try {
      const res = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers: {
          ...input.visitorHeaders,
          ...(input.clientIp ? { "X-Forwarded-For": input.clientIp } : {}),
          "X-Forwarded-Host": input.host,
          "X-Forwarded-Proto": input.proto,
          ...(input.port ? { "X-Forwarded-Port": input.port } : {}),
          "X-Routy-Edge-Auth": this.cfg.routyApiKey,
          "X-Routy-Edge-Client": this.cfg.edgeClientHeader,
          "Idempotency-Key": input.idempotencyKey,
          Accept: "application/json",
        },
      });
      if (res.status === 429) {
        throw new RoutyTransportError(`rate limited`, "http_429");
      }
      if (res.status >= 500) {
        throw new RoutyTransportError(`upstream ${res.status}`, "http_5xx");
      }
      const text = await res.text();
      try {
        return JSON.parse(text) as ResolveResponse;
      } catch {
        throw new RoutyTransportError("invalid JSON from Routy", "bad_json");
      }
    } catch (err) {
      if (err instanceof RoutyTransportError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new RoutyTransportError("timeout", "timeout");
      }
      throw new RoutyTransportError(
        `network error: ${err instanceof Error ? err.message : String(err)}`,
        "network"
      );
    } finally {
      clearTimeout(t);
    }
  }

  async replay(clicks: ReplayClick[]): Promise<ReplayResponse> {
    const url = `${this.cfg.routyBaseUrl}/route/replay?pr=v1`;
    const controller = new AbortController();
    // Replay isn't visitor-facing; give it a much more generous timeout.
    const t = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "X-Routy-Edge-Auth": this.cfg.routyApiKey,
          "X-Routy-Edge-Client": this.cfg.edgeClientHeader,
          Accept: "application/json",
        },
        body: JSON.stringify({ clicks }),
      });
      if (!res.ok) {
        throw new RoutyTransportError(`replay http ${res.status}`, "http_5xx");
      }
      return (await res.json()) as ReplayResponse;
    } catch (err) {
      if (err instanceof RoutyTransportError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new RoutyTransportError("replay timeout", "timeout");
      }
      throw new RoutyTransportError(
        `replay network error: ${err instanceof Error ? err.message : String(err)}`,
        "network"
      );
    } finally {
      clearTimeout(t);
    }
  }

  private buildResolveUrl(input: ResolveInput): string {
    const base = `${this.cfg.routyBaseUrl}/route`;
    const params = new URLSearchParams(input.queryString);
    params.set("pr", "v1");
    params.set("slug", input.slug);
    return `${base}?${params.toString()}`;
  }
}
