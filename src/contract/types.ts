// Wire types for the pr=v1 contract. See CONTRACT.md.

export type RedirectMode = "302" | "cloaked";

export interface ResolveResponseOk {
  version: "v1";
  status: "ok";
  redirect: {
    mode: RedirectMode;
    templateUrl: string;
    renderedUrl: string;
    placeholders: {
      clickId: string;
      dynamic: string;
      tracker: string | null;
    };
  };
  click: {
    id: string;
    brandLinkId: string;
    accountId: string;
    affiliateDomain: {
      id: string;
      host: string;
      trafficSourceId: string | null;
    };
    cid: string | null;
  };
  cache: {
    ttlSeconds: number;
    key: string;
  };
  error: null;
}

export type ErrorCode =
  | "LINK_NOT_FOUND"
  | "LINK_DISABLED"
  | "DOMAIN_NOT_FOUND"
  | "QUOTA_EXCEEDED"
  | "INVALID_REQUEST"
  | "RATE_LIMITED"
  | string; // unknown codes treated as 500

export interface ResolveResponseError {
  version: "v1";
  status: "error";
  redirect: null;
  click: null;
  cache: null;
  error: {
    code: ErrorCode;
    message: string;
    httpStatus: number;
    responseBody: string | null;
    retryAfterSeconds?: number;
  };
}

export type ResolveResponse = ResolveResponseOk | ResolveResponseError;

export interface ReplayClick {
  edgeClickId: string;
  occurredAt: string; // ISO 8601
  host: string;
  slug: string;
  cid: string | null;
  queryString: string;
  ip: string | null;
  userAgent: string | null;
  referrer: string | null;
  renderedTargetUrl: string;
  templateUrl: string;
}

export interface ReplayRequest {
  clicks: ReplayClick[];
}

export type ReplayRejectionReason =
  | "duplicate"
  | "link_not_found"
  | "domain_not_found"
  | "too_old"
  | "clock_skew"
  | "quota_exceeded"
  | "temporary"
  | string;

export type ReplayResult =
  | { edgeClickId: string; status: "accepted"; routyClickId: string }
  | { edgeClickId: string; status: "rejected"; reason: ReplayRejectionReason };

export interface ReplayResponse {
  version: "v1";
  results: ReplayResult[];
}

// Constants from §5.3 — edge-side enforcement avoids infinite retry on
// unknown reasons (per §10 stability guarantee).
export const MAX_REPLAY_AGE_DAYS = 7;
export const MAX_CLOCK_SKEW_SECONDS = 300;
