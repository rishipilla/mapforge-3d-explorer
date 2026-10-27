import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import overpass from "../api/overpass.ts";
import { readFile } from "node:fs/promises";

type MockResponse = {
  statusCode?: number;
  headers: Record<string, string>;
  body?: string;
  status(code: number): MockResponse;
  setHeader(name: string, value: string): void;
  send(body: string): void;
  end(): void;
};

function createResponse(): MockResponse {
  return {
    headers: {},
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name] = value; },
    send(body) { this.body = body; },
    end() {},
  };
}

const originalFetch = globalThis.fetch;
const originalPrimary = process.env.OVERPASS_API_URL;
const originalFallback = process.env.OVERPASS_FALLBACK_URL;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalPrimary === undefined) delete process.env.OVERPASS_API_URL;
  else process.env.OVERPASS_API_URL = originalPrimary;
  if (originalFallback === undefined) delete process.env.OVERPASS_FALLBACK_URL;
  else process.env.OVERPASS_FALLBACK_URL = originalFallback;
});

describe("Overpass API proxy", () => {
  test("accepts POST queries and returns valid upstream map data", async () => {
    let forwardedBody = "";
    process.env.OVERPASS_API_URL = "https://overpass.example/api/interpreter";
    process.env.OVERPASS_FALLBACK_URL = "https://fallback.example/api/interpreter";
    globalThis.fetch = async (_input, init) => {
      forwardedBody = String(init?.body);
      return new Response(JSON.stringify({ elements: [{ id: 1 }] }), { status: 200 });
    };

    const response = createResponse();
    await overpass({ method: "POST", body: "[out:json];out;" }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(forwardedBody, "[out:json];out;");
    assert.deepEqual(JSON.parse(response.body ?? "{}"), { elements: [{ id: 1 }] });
    assert.equal(response.headers["Content-Type"], "application/json; charset=utf-8");
  });

  test("returns clear method and body errors without contacting upstream", async () => {
    globalThis.fetch = async () => { throw new Error("fetch should not be called"); };
    const methodResponse = createResponse();
    await overpass({ method: "GET" }, methodResponse);
    assert.equal(methodResponse.statusCode, 405);
    assert.equal(methodResponse.headers.Allow, "POST");

    const bodyResponse = createResponse();
    await overpass({ method: "POST", body: "" }, bodyResponse);
    assert.equal(bodyResponse.statusCode, 400);
    assert.match(bodyResponse.body ?? "", /non-empty Overpass query/);
  });

  test("falls back on a failed upstream and reports unavailable services", async () => {
    process.env.OVERPASS_API_URL = "https://overpass.example/api/interpreter";
    process.env.OVERPASS_FALLBACK_URL = "https://fallback.example/api/interpreter";
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      if (calls === 1) throw new Error("primary unavailable");
      return new Response(JSON.stringify({ elements: [] }), { status: 200 });
    };
    const response = createResponse();
    await overpass({ method: "POST", body: "query" }, response);
    assert.equal(response.statusCode, 200);
    assert.equal(calls, 2);

    globalThis.fetch = async () => { throw new Error("all upstreams unavailable"); };
    const failedResponse = createResponse();
    await overpass({ method: "POST", body: "query" }, failedResponse);
    assert.equal(failedResponse.statusCode, 502);
    assert.match(failedResponse.body ?? "", /could not be reached/);
  });

  test("the browser calls only the same-origin proxy and resets loading in finally", async () => {
    const app = await readFile(new URL("../src/ui/App.tsx", import.meta.url), "utf8");
    assert.match(app, /fetch\("\/api\/overpass"/);
    assert.doesNotMatch(app, /https:\/\/overpass-(?:api\.de|kumi\.systems)\/api\/interpreter/);
    assert.match(app, /finally\s*\{[\s\S]*?setIsFetchingBuildings\(false\)/);
    assert.match(app, /if \(controller\.signal\.aborted\)[\s\S]*?setBuildStatus\(""\)/);
    assert.match(app, /const retryIndoorData = async \(\) => \{[\s\S]*?const success = await requestBuildings\(\);/);
    assert.match(app, /setAreaData\(data\)[\s\S]*?catch \(error\)/);

    const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
    assert.equal(config.framework, "vite");
    assert.equal(config.outputDirectory, "dist");
    assert.equal(config.functions["api/overpass.ts"].maxDuration, 30);
    assert.equal(config.rewrites, undefined);
  });
});
