export type OverpassResponse = {
  elements: any[];
  [key: string]: unknown;
};

export type FetchLike = typeof fetch;

export function createOverpassClient(fetcher: FetchLike = (...args) => fetch(...args)) {
  let inFlight: Promise<OverpassResponse> | null = null;

  return {
    request(query: string, signal: AbortSignal): Promise<OverpassResponse> {
      if (inFlight) return inFlight;

      const request = (async () => {
        const response = await fetcher("/api/overpass", {
          method: "POST",
          body: query,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
          signal,
        });
        const data: unknown = await response.json().catch(() => ({}));
        if (!response.ok) {
          const error = data && typeof data === "object" && "error" in data
            ? (data as { error?: unknown }).error
            : undefined;
          throw new Error(
            typeof error === "string"
              ? error
              : `Map data request failed (HTTP ${response.status}).`,
          );
        }
        if (!data || typeof data !== "object" || !Array.isArray((data as { elements?: unknown }).elements)) {
          throw new Error("The map data service returned an invalid response.");
        }
        return data as OverpassResponse;
      })();

      inFlight = request;
      void request.finally(() => {
        if (inFlight === request) inFlight = null;
      }).catch(() => undefined);
      return request;
    },
  };
}
