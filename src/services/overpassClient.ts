
export type OverpassResponse = {
  elements: any[];
  [key: string]: unknown;
};

export type FetchLike = typeof fetch;

const RETRYABLE_STATUSES = new Set([406, 429, 502, 503, 504]);
const RETRY_DELAYS_MS = [400];

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
  const inFlight = new Map<string, Promise<OverpassResponse>>();

  return {
    request(query: string, signal: AbortSignal): Promise<OverpassResponse> {
      const existing = inFlight.get(query);
      if (existing) return existing;

      const request = (async () => {
        for (let attempt = 0; ; attempt++) {
          try {
            const response = await fetcher("/api/overpass", {
              method: "POST",
              body: query,
              headers: {
                "Content-Type": "text/plain; charset=utf-8",
              },
              signal,
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
            if (signal.aborted) throw error;

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

            await waitBeforeRetry(RETRY_DELAYS_MS[attempt], signal);
          }
        }
      })();

      inFlight.set(query, request);

      void request.finally(() => {
        if (inFlight.get(query) === request) {
          inFlight.delete(query);
        }
      }).catch(() => undefined);

      return request;
    },
  };
}
