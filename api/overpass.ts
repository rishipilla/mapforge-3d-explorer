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
// Two upstream attempts must fit inside the 30 second Vercel function limit.
const UPSTREAM_TIMEOUT_MS = 12_000;
const DEFAULT_ENDPOINT = "https://overpass-api.de/api/interpreter";
const DEFAULT_FALLBACK = "https://overpass.kumi.systems/api/interpreter";

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

  let endpoints: string[];
  try {
    endpoints = [
      configuredEndpoint(process.env.OVERPASS_API_URL, DEFAULT_ENDPOINT),
      configuredEndpoint(process.env.OVERPASS_FALLBACK_URL, DEFAULT_FALLBACK),
    ].filter((endpoint, index, list) => list.indexOf(endpoint) === index);
  } catch {
    return sendJson(res, 500, { error: "Overpass endpoint configuration is invalid." });
  }

  for (let index = 0; index < endpoints.length; index += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    let upstream: Response;
    let responseText: string;
    try {
      upstream = await fetch(endpoints[index], {
        method: "POST",
        headers: { "Content-Type": "text/plain; charset=utf-8", Accept: "application/json" },
        body: query,
        signal: controller.signal,
      });
      responseText = await upstream.text();
    } catch (error) {
      clearTimeout(timeout);
      const isTimeout = error instanceof Error && error.name === "AbortError";
      if (index + 1 < endpoints.length) continue;
      return sendJson(res, isTimeout ? 504 : 502, {
        error: isTimeout ? "The Overpass service timed out. Please retry." : "The Overpass service could not be reached.",
      });
    }
    clearTimeout(timeout);

    if (!upstream.ok) {
      if (upstream.status === 429) {
        if (index + 1 < endpoints.length) continue;
        const retryAfter = upstream.headers.get("retry-after");
        if (retryAfter) res.setHeader("Retry-After", retryAfter);
        return sendJson(res, 429, { error: "Overpass is rate limiting requests. Please wait and retry." });
      }
      const transient = [502, 503, 504].includes(upstream.status);
      if (transient && index + 1 < endpoints.length) continue;
      return sendJson(res, transient ? 503 : 502, {
        error: `Overpass returned HTTP ${upstream.status}. Please retry later.`,
      });
    }

    let data: unknown;
    try {
      data = JSON.parse(responseText);
    } catch {
      return sendJson(res, 502, { error: "Overpass returned malformed JSON." });
    }
    if (!data || typeof data !== "object" || !Array.isArray((data as { elements?: unknown }).elements)) {
      return sendJson(res, 502, { error: "Overpass returned an invalid map data response." });
    }
    return sendJson(res, 200, data as Record<string, unknown>);
  }

  return sendJson(res, 503, { error: "Overpass is temporarily unavailable. Please retry." });
}
