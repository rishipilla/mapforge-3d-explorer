import { createHash } from "node:crypto";

type ApiRequest = {
  method?: string;
  body?: unknown;
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  setHeader: (name: string, value: string) => void;
  send: (body: string) => void;
  end: () => void;
};

const MAX_QUERY_BYTES = 256 * 1024;
// Three 20s attempts are hedged over 5s, keeping the worst case under Vercel's 30s limit.
const UPSTREAM_TIMEOUT_MS = 20_000;
const MIRROR_HEDGE_DELAY_MS = 2_500;
const DEFAULT_ENDPOINT = "https://overpass-api.de/api/interpreter";
const DEFAULT_FALLBACK = "https://overpass.kumi.systems/api/interpreter";
const DEFAULT_FALLBACK_2 = "https://overpass.openstreetmap.ru/api/interpreter";

// Simple in-memory cache: keyed by query text, TTL-based, size-capped.
// Resets on cold start, which is fine — it just reduces repeat load during a warm instance's life.
const CACHE_TTL_MS = 8 * 60 * 1000; // 8 minutes
const CACHE_MAX_ENTRIES = 200;
const cache = new Map<string, { data: Record<string, unknown>; expiresAt: number }>();

function cacheGet(key: string): Record<string, unknown> | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  // refresh recency
  cache.delete(key);
  cache.set(key, entry);
  return entry.data;
}

function cacheSet(key: string, data: Record<string, unknown>) {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

function hashQuery(query: string): string {
  return createHash("sha256").update(query).digest("hex");
}

function configuredEndpoint(value: string | undefined, fallback: string): string {
  const endpoint = value || fallback;
  const parsed = new URL(endpoint);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/api/interpreter" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("Overpass endpoint configuration is invalid");
  }
  return parsed.toString();
}

function sendJson(res: ApiResponse, status: number, body: Record<string, unknown>) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send(JSON.stringify(body));
}

type UpstreamOutcome =
  | { data: Record<string, unknown> }
  | { status: number; error: string; retryAfter?: string };

function isRetryableUpstreamStatus(status: number) {
  return [406, 429, 502, 503, 504].includes(status);
}

async function fetchFromMirror(endpoint: string, query: string, signal: AbortSignal): Promise<UpstreamOutcome> {
  let upstream: Response;
  let responseText: string;
  try {
    upstream = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: query,
      signal,
    });
    responseText = await upstream.text();
  } catch (error) {
    const timedOut = signal.aborted || (error instanceof Error && error.name === "AbortError");
    return {
      status: timedOut ? 504 : 502,
      error: timedOut ? "The Overpass mirror timed out." : "The Overpass mirror could not be reached.",
    };
  }

  if (!upstream.ok) {
    return {
      status: upstream.status,
      error: `Overpass returned HTTP ${upstream.status}.`,
      retryAfter: upstream.headers.get("retry-after") ?? undefined,
    };
  }

  let data: unknown;
  try {
    data = JSON.parse(responseText);
  } catch {
    return { status: 502, error: "Overpass returned malformed JSON." };
  }
  if (!data || typeof data !== "object" || !Array.isArray((data as { elements?: unknown }).elements)) {
    return { status: 502, error: "Overpass returned an invalid map data response." };
  }
  return { data: data as Record<string, unknown> };
}

function requestOverpass(query: string, endpoints: string[]): Promise<UpstreamOutcome> {
  return new Promise((resolve) => {
    const controllers: AbortController[] = [];
    const failures: Array<Extract<UpstreamOutcome, { status: number }> | undefined> = [];
    const hedgeTimers: ReturnType<typeof setTimeout>[] = [];
    let nextEndpoint = 0;
    let activeRequests = 0;
    let settled = false;

    const finish = (outcome: UpstreamOutcome) => {
      if (settled) return;
      settled = true;
      hedgeTimers.forEach(clearTimeout);
      controllers.forEach((controller) => controller.abort());
      resolve(outcome);
    };

    const finishWithFailures = () => {
      const recordedFailures = failures.filter((failure): failure is Extract<UpstreamOutcome, { status: number }> => Boolean(failure));
      const timedOut = recordedFailures.length > 0 && recordedFailures.every((failure) => failure.status === 504);
      const rateLimited = recordedFailures.length > 0 && recordedFailures.every((failure) => failure.status === 429);
      const unreachable = recordedFailures.length > 0 && recordedFailures.every((failure) => failure.status === 502);
      const last = recordedFailures[recordedFailures.length - 1];
      finish({
        status: timedOut ? 504 : rateLimited ? 429 : unreachable ? 502 : 503,
        error: timedOut
          ? "All Overpass mirrors timed out. Try a smaller map area or retry."
          : rateLimited
            ? "Overpass mirrors are rate limiting requests. Please wait and retry."
            : unreachable
              ? "Overpass mirrors could not be reached."
              : last?.error ?? "Overpass mirrors are temporarily unavailable.",
        retryAfter: rateLimited ? recordedFailures.find((failure) => failure.retryAfter)?.retryAfter : undefined,
      });
    };

    const startNext = () => {
      if (settled || nextEndpoint >= endpoints.length) return;
      const index = nextEndpoint++;
      const controller = new AbortController();
      controllers.push(controller);
      activeRequests += 1;
      const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

      void fetchFromMirror(endpoints[index], query, controller.signal)
        .then((outcome) => {
          if ("data" in outcome) {
            finish(outcome);
            return;
          }
          failures[index] = outcome;
          if (!isRetryableUpstreamStatus(outcome.status)) {
            finish(outcome);
          }
        })
        .finally(() => {
          clearTimeout(timeout);
          activeRequests -= 1;
          if (settled) return;
          if (nextEndpoint < endpoints.length && failures[index]) startNext();
          if (nextEndpoint === endpoints.length && activeRequests === 0) finishWithFailures();
        });
    };

    startNext();
    for (let index = 1; index < endpoints.length; index += 1) {
      hedgeTimers.push(setTimeout(startNext, MIRROR_HEDGE_DELAY_MS * index));
    }
  });
}

export default async function overpass(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "Use POST to submit an Overpass query." });
  }

  const query = typeof req.body === "string"
    ? req.body
    : req.body && typeof req.body === "object" && "query" in req.body
      ? (req.body as { query: unknown }).query
      : undefined;
  if (typeof query !== "string" || !query.trim()) {
    return sendJson(res, 400, { error: "A non-empty Overpass query string is required." });
  }
  if (new TextEncoder().encode(query).byteLength > MAX_QUERY_BYTES) {
    return sendJson(res, 413, { error: "The Overpass query exceeds the 256 KB limit." });
  }

  // Serve from cache if we've seen this exact query recently.
  const cacheKey = hashQuery(query);
  const cached = cacheGet(cacheKey);
  if (cached) {
    return sendJson(res, 200, cached);
  }

  let endpoints: string[];
  try {
    endpoints = [
      configuredEndpoint(process.env.OVERPASS_API_URL, DEFAULT_ENDPOINT),
      configuredEndpoint(process.env.OVERPASS_FALLBACK_URL, DEFAULT_FALLBACK),
      configuredEndpoint(process.env.OVERPASS_FALLBACK_URL_2, DEFAULT_FALLBACK_2),
    ].filter((endpoint, index, list) => list.indexOf(endpoint) === index);
  } catch {
    return sendJson(res, 500, { error: "Overpass endpoint configuration is invalid." });
  }

  const outcome = await requestOverpass(query, endpoints);
  if ("data" in outcome) {
    cacheSet(cacheKey, outcome.data);
    return sendJson(res, 200, outcome.data);
  }
  if (outcome.retryAfter) res.setHeader("Retry-After", outcome.retryAfter);
  return sendJson(res, outcome.status, { error: outcome.error });
}
