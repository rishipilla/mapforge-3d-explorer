
export type OverpassResponse = {
  elements: any[];
  [key: string]: unknown;
};

export type FetchLike = typeof fetch;

const RETRYABLE_STATUSES = new Set([406, 429, 502, 503, 504]);
const RETRY_DELAYS_MS = [300, 900];

function waitBeforeRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Request aborted.", "AbortError"));
      return;
    }

    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);

    const onAbort = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      reject(new DOMException("Request aborted.", "AbortError"));
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function createOverpassClient(
  fetcher: FetchLike = (...args) => fetch(...args),
) {
  const inFlight = new Map<string, { promise: Promise<OverpassResponse>; controller: AbortController; consumers: number }>();

  const subscribe = (
    query: string,
    entry: { promise: Promise<OverpassResponse>; controller: AbortController; consumers: number },
    signal: AbortSignal,
  ) => new Promise<OverpassResponse>((resolve, reject) => {
    if (signal.aborted) {
      if (entry.consumers === 0 && inFlight.get(query) === entry) entry.controller.abort();
      reject(new DOMException("Request aborted.", "AbortError"));
      return;
    }
    entry.consumers += 1;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      signal.removeEventListener("abort", onAbort);
      entry.consumers -= 1;
      if (entry.consumers === 0 && inFlight.get(query) === entry) entry.controller.abort();
    };
    const onAbort = () => {
      finish();
      reject(new DOMException("Request aborted.", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    entry.promise.then(
      (data) => { if (!finished) { finish(); resolve(data); } },
      (error) => { if (!finished) { finish(); reject(error); } },
    );
  });

  return {
    request(query: string, signal: AbortSignal): Promise<OverpassResponse> {
      const existing = inFlight.get(query);
      if (existing) return subscribe(query, existing, signal);
      const controller = new AbortController();

      const request = (async () => {
        for (let attempt = 0; ; attempt++) {
          try {
            const response = await fetcher("/api/overpass", {
              method: "POST",
              body: query,
              headers: {
                "Content-Type": "text/plain; charset=utf-8",
              },
              signal: controller.signal,
            });

            const data: unknown = await response.json().catch(() => ({}));

            if (!response.ok) {
              const error =
                data && typeof data === "object" && "error" in data
                  ? (data as { error?: unknown }).error
                  : undefined;

              const message =
                typeof error === "string"
                  ? error
                  : `Map data request failed (HTTP ${response.status}).`;

              const requestError = Object.assign(new Error(message), {
                status: response.status,
                retryAfter: response.headers.get("retry-after") ?? undefined,
              });

              throw requestError;
            }

            if (
              !data ||
              typeof data !== "object" ||
              !Array.isArray((data as { elements?: unknown }).elements)
            ) {
              throw new Error(
                "The map data service returned an invalid response.",
              );
            }

            return data as OverpassResponse;
          } catch (error) {
            if (controller.signal.aborted) throw error;

            const status =
              error && typeof error === "object" && "status" in error
                ? (error as { status?: unknown }).status
                : undefined;

            const retryable =
              status === undefined ||
              (typeof status === "number" &&
                RETRYABLE_STATUSES.has(status));

            if (!retryable || attempt >= RETRY_DELAYS_MS.length) {
              throw error;
            }

            const baseDelay = RETRY_DELAYS_MS[attempt];
            const jitteredDelay = Math.round(baseDelay * (0.8 + Math.random() * 0.4));
            const retryAfterValue = error && typeof error === "object" && "retryAfter" in error
              ? (error as { retryAfter?: unknown }).retryAfter
              : undefined;
            const retryAfterSeconds = typeof retryAfterValue === "string" ? Number(retryAfterValue) : NaN;
            const retryAfterDate = typeof retryAfterValue === "string" ? Date.parse(retryAfterValue) : NaN;
            const retryAfterMs = Number.isFinite(retryAfterSeconds)
              ? retryAfterSeconds * 1000
              : Number.isFinite(retryAfterDate) ? Math.max(0, retryAfterDate - Date.now()) : NaN;
            const retryAfter = Number.isFinite(retryAfterMs) ? Math.min(10_000, Math.max(0, retryAfterMs)) : NaN;
            await waitBeforeRetry(Number.isFinite(retryAfter) ? Math.max(jitteredDelay, retryAfter) : jitteredDelay, controller.signal);
          }
        }
      })();

      const entry = { promise: request, controller, consumers: 0 };
      inFlight.set(query, entry);

      void request.finally(() => {
        if (inFlight.get(query) === entry) {
          inFlight.delete(query);
        }
      }).catch(() => undefined);

      return subscribe(query, entry, signal);
    },
  };
}
