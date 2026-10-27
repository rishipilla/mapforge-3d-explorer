import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createOverpassClient } from "../src/services/overpassClient.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Overpass client generation requests", () => {
  test("successfully posts the query to the same-origin proxy and parses map data", async () => {
    let requestedUrl = "";
    let requestBody = "";
    globalThis.fetch = async (input, init) => {
      requestedUrl = String(input);
      requestBody = String(init?.body);
      return new Response(JSON.stringify({ elements: [{ id: 1 }] }), { status: 200 });
    };

    const client = createOverpassClient();
    const data = await client.request("[out:json];out;", new AbortController().signal);

    assert.equal(requestedUrl, "/api/overpass");
    assert.equal(requestBody, "[out:json];out;");
    assert.deepEqual(data.elements, [{ id: 1 }]);
  });

  test("surfaces proxy errors so the UI can leave loading and show Retry", async () => {
    globalThis.fetch = async () => new Response(
      JSON.stringify({ error: "Overpass is temporarily unavailable." }),
      { status: 503 },
    );
    const client = createOverpassClient();

    await assert.rejects(
      client.request("query", new AbortController().signal),
      /Overpass is temporarily unavailable/,
    );
  });

  test("propagates cancellation and releases the request slot", async () => {
    let observedSignal: AbortSignal | undefined;
    globalThis.fetch = async (_input, init) => {
      observedSignal = init?.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => {
        observedSignal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    };
    const client = createOverpassClient();
    const controller = new AbortController();
    const request = client.request("query", controller.signal);
    controller.abort();

    await assert.rejects(request, { name: "AbortError" });
    assert.equal(observedSignal?.aborted, true);
  });

  test("coalesces duplicate Generate clicks into one network request", async () => {
    let calls = 0;
    let resolveResponse!: (response: Response) => void;
    globalThis.fetch = async () => {
      calls += 1;
      return new Promise<Response>((resolve) => { resolveResponse = resolve; });
    };
    const client = createOverpassClient();
    const signal = new AbortController().signal;
    const first = client.request("query", signal);
    const second = client.request("query", signal);

    assert.equal(second, first);
    assert.equal(calls, 1);
    resolveResponse(new Response(JSON.stringify({ elements: [] }), { status: 200 }));
    await Promise.all([first, second]);
  });
});
