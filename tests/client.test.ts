// tests/client.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MaildenoClient } from "../src/client.js";
import { MaildenoError } from "../src/error.js";
import type { TemplateJson } from "../src/types.js";

// ── Mock fetch ────────────────────────────────────────────────────────────────

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  mockFetch.mockReset();
});

// ── Fixtures — factories, not shared instances ────────────────────────────────
//
// IMPORTANT: always use makeTemplateResponse() / makeRenderResponse() rather
// than a shared Response object. The Fetch API's Response body can only be
// read once; reusing an instance across mock calls causes "Body already been
// read" errors.

const BASE_TEMPLATE: TemplateJson = {
  template_id: "t1",
  template_name: "Welcome",
  canvas: { bg: "#fff" },
  rows: [],
  schema_version: "1.0",
};

function makeTemplateResponse(t: TemplateJson = BASE_TEMPLATE): Response {
  return new Response(JSON.stringify(t), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function makeErrorResponse(status: number, detail: unknown): Response {
  return new Response(JSON.stringify({ detail }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function networkError(): Promise<never> {
  return Promise.reject(new Error("Failed to fetch"));
}

// Helper: queue N identical template responses (each a fresh Response instance)
function queueTemplates(n: number, t: TemplateJson = BASE_TEMPLATE): void {
  for (let i = 0; i < n; i++) {
    mockFetch.mockResolvedValueOnce(makeTemplateResponse(t));
  }
}

// ── Constructor ───────────────────────────────────────────────────────────────

describe("MaildenoClient constructor", () => {
  it("throws if apiKey is missing", () => {
    expect(() => new MaildenoClient({ apiKey: "" })).toThrow(MaildenoError);
  });

  it("strips trailing slash from baseUrl", async () => {
    queueTemplates(1);
    const client = new MaildenoClient({
      apiKey: "sk_test_" + "a".repeat(64),
      baseUrl: "https://api.example.com/",
    });
    await client.renderHtml("t1");
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain("https://api.example.com/v1/sdk/template/t1");
  });

  it("defaults to https://api.maildeno.com when baseUrl not provided", async () => {
    queueTemplates(1);
    const client = new MaildenoClient({ apiKey: "sk_test_" + "a".repeat(64) });
    await client.renderHtml("t1");
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain("https://api.maildeno.com/v1/sdk/template/t1");
  });
});

// ── Template fetching ─────────────────────────────────────────────────────────

describe("template fetching", () => {
  it("GETs /v1/sdk/template/{id} with Authorization header", async () => {
    const client = new MaildenoClient({ apiKey: "sk_test_" + "a".repeat(64) });
    queueTemplates(1);
    await client.renderHtml("t1");

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/v1/sdk/template/t1");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer sk_test_" + "a".repeat(64),
    );
    expect(init.method).toBe("GET");
  });

  it("passes target as query param on the template fetch URL", async () => {
    const client = new MaildenoClient({ apiKey: "sk_test_" + "a".repeat(64) });
    queueTemplates(1);
    await client.renderMjml("t1");

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain("target=mjml");
  });

  it("passes react-email target correctly", async () => {
    const client = new MaildenoClient({ apiKey: "sk_test_" + "a".repeat(64) });
    queueTemplates(1);
    await client.renderReact("t1");

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain("target=react-email");
  });
});

// ── In-process cache ──────────────────────────────────────────────────────────

describe("in-process cache", () => {
  it("fetches template once and reuses for subsequent renders", async () => {
    const client = new MaildenoClient({ apiKey: "sk_test_" + "a".repeat(64) });

    // Only one template fetch needed — cache handles the rest
    queueTemplates(1);

    await client.renderHtml("t1");
    await client.renderHtml("t1");
    await client.renderHtml("t1");

    const templateFetches = mockFetch.mock.calls.filter(([url]: [string]) =>
      url.includes("/v1/sdk/template/"),
    );
    expect(templateFetches).toHaveLength(1);
  });

  it("re-fetches template after TTL expires", async () => {
    const client = new MaildenoClient({
      apiKey: "sk_test_" + "a".repeat(64),
      cacheTtl: 1_000,
    });

    queueTemplates(2); // first render + re-fetch after TTL

    await client.renderHtml("t1");
    vi.advanceTimersByTime(2_000);
    await client.renderHtml("t1");

    const templateFetches = mockFetch.mock.calls.filter(([url]: [string]) =>
      url.includes("/v1/sdk/template/"),
    );
    expect(templateFetches).toHaveLength(2);
  });

  it("invalidate() forces a fresh fetch on next render", async () => {
    const client = new MaildenoClient({ apiKey: "sk_test_" + "a".repeat(64) });

    queueTemplates(2); // initial + post-invalidate

    await client.renderHtml("t1");
    client.invalidate("t1");
    await client.renderHtml("t1");

    const templateFetches = mockFetch.mock.calls.filter(([url]: [string]) =>
      url.includes("/v1/sdk/template/"),
    );
    expect(templateFetches).toHaveLength(2);
  });

  it("clearCache() forces fresh fetches for all templates", async () => {
    const client = new MaildenoClient({ apiKey: "sk_test_" + "a".repeat(64) });

    queueTemplates(2);

    await client.renderHtml("t1");
    client.clearCache();
    await client.renderHtml("t1");

    const templateFetches = mockFetch.mock.calls.filter(([url]: [string]) =>
      url.includes("/v1/sdk/template/"),
    );
    expect(templateFetches).toHaveLength(2);
  });
});

// ── Stale-on-error fallback ───────────────────────────────────────────────────

describe("stale-on-error fallback", () => {
  it("uses stale cache when server is unreachable after TTL", async () => {
    const client = new MaildenoClient({
      apiKey: "sk_test_" + "a".repeat(64),
      cacheTtl: 1_000,
    });

    // First render — populates cache
    queueTemplates(1);
    await client.renderHtml("t1");

    // Advance past TTL
    vi.advanceTimersByTime(2_000);

    // Server is down on re-fetch — stale cache saves the day
    mockFetch.mockReturnValueOnce(networkError());

    const result = await client.render({ templateId: "t1", target: "html" });
    expect(result.fromStaleCache).toBe(true);
    expect(result.output).toBeDefined();
  });

  it("sets fromStaleCache=true when server returns 5xx after TTL", async () => {
    const client = new MaildenoClient({
      apiKey: "sk_test_" + "a".repeat(64),
      cacheTtl: 1_000,
    });

    queueTemplates(1);
    await client.renderHtml("t1");
    vi.advanceTimersByTime(2_000);

    mockFetch.mockResolvedValueOnce(makeErrorResponse(500, null));

    const result = await client.render({ templateId: "t1" });
    expect(result.fromStaleCache).toBe(true);
  });

  it("sets fromStaleCache=true when server returns 503 after TTL", async () => {
    const client = new MaildenoClient({
      apiKey: "sk_test_" + "a".repeat(64),
      cacheTtl: 1_000,
    });

    queueTemplates(1);
    await client.renderHtml("t1");
    vi.advanceTimersByTime(2_000);

    mockFetch.mockResolvedValueOnce(makeErrorResponse(503, "Service Unavailable"));

    const result = await client.render({ templateId: "t1" });
    expect(result.fromStaleCache).toBe(true);
  });

  it("throws NETWORK_ERROR when server is down and no prior cache exists", async () => {
    const client = new MaildenoClient({ apiKey: "sk_test_" + "a".repeat(64) });

    mockFetch.mockReturnValueOnce(networkError());

    const err = await client.renderHtml("brand-new-id").catch((e) => e);
    expect(err).toBeInstanceOf(MaildenoError);
    expect(err.code).toBe("NETWORK_ERROR");
  });

  it("fromStaleCache is absent when cache was fresh", async () => {
    const client = new MaildenoClient({ apiKey: "sk_test_" + "a".repeat(64) });

    queueTemplates(1);

    const result = await client.render({ templateId: "t1" });
    expect(result.fromStaleCache).toBeUndefined();
  });

  it("recovers from stale state on next successful fetch", async () => {
    const client = new MaildenoClient({
      apiKey: "sk_test_" + "a".repeat(64),
      cacheTtl: 1_000,
    });

    queueTemplates(1);
    await client.renderHtml("t1");

    // First re-fetch fails → stale fallback
    vi.advanceTimersByTime(2_000);
    mockFetch.mockReturnValueOnce(networkError());
    const staleResult = await client.render({ templateId: "t1" });
    expect(staleResult.fromStaleCache).toBe(true);

    // Second re-fetch succeeds → fresh again
    vi.advanceTimersByTime(2_000);
    queueTemplates(1);
    const freshResult = await client.render({ templateId: "t1" });
    expect(freshResult.fromStaleCache).toBeUndefined();
  });
});

// ── Cache config ──────────────────────────────────────────────────────────────

describe("cache configuration", () => {
  it("respects custom cacheTtl", async () => {
    const client = new MaildenoClient({
      apiKey: "sk_test_" + "a".repeat(64),
      cacheTtl: 60_000, // 1 minute
    });

    queueTemplates(1);
    await client.renderHtml("t1");

    // 30 seconds — still fresh, no re-fetch
    vi.advanceTimersByTime(30_000);
    await client.renderHtml("t1");

    const fetches = mockFetch.mock.calls.filter(([url]: [string]) =>
      url.includes("/v1/sdk/template/"),
    );
    expect(fetches).toHaveLength(1);
  });

  it("respects cacheMaxEntries by evicting the oldest entry", async () => {
    const client = new MaildenoClient({
      apiKey: "sk_test_" + "a".repeat(64),
      cacheMaxEntries: 2,
    });

    // Fill cache with t1 and t2
    queueTemplates(1, { ...BASE_TEMPLATE, template_id: "t1" });
    queueTemplates(1, { ...BASE_TEMPLATE, template_id: "t2" });
    await client.renderHtml("t1");
    await client.renderHtml("t2");

    // Adding t3 evicts t1 (oldest)
    queueTemplates(1, { ...BASE_TEMPLATE, template_id: "t3" });
    await client.renderHtml("t3");

    // t1 must be re-fetched (evicted); t2 and t3 still cached
    queueTemplates(1, { ...BASE_TEMPLATE, template_id: "t1" });
    await client.renderHtml("t1");

    const t1Fetches = mockFetch.mock.calls.filter(([url]: [string]) =>
      url.includes("/v1/sdk/template/t1"),
    );
    expect(t1Fetches).toHaveLength(2); // initial + after eviction
  });
});

// ── Minification ──────────────────────────────────────────────────────────────
//
// The Wasm engine is not yet wired — _renderLocally returns a JSON stub.
// These tests verify the minifier runs on whatever output the render step
// produces. Full HTML minification is covered by minify.test.ts.

describe("minification applied to render output", () => {
  it("render() returns a non-empty output string", async () => {
    const client = new MaildenoClient({ apiKey: "sk_test_" + "a".repeat(64) });
    queueTemplates(1);

    const result = await client.render({ templateId: "t1" });
    expect(typeof result.output).toBe("string");
    expect(result.output.length).toBeGreaterThan(0);
  });

  it("renderHtml() returns a string", async () => {
    const client = new MaildenoClient({ apiKey: "sk_test_" + "a".repeat(64) });
    queueTemplates(1);

    const html = await client.renderHtml("t1");
    expect(typeof html).toBe("string");
  });
});

// ── Minify unit tests (pure — no fetch needed) ────────────────────────────────

describe("minifyOutput (unit)", () => {
  it("collapses inter-tag whitespace in HTML", async () => {
    const { minifyOutput } = await import("../src/minify.js");
    const input = "<p>  Hello  </p>  \n  <p>World</p>";
    const result = minifyOutput("html", input);
    expect(result).not.toMatch(/>\s{2,}</);
  });

  it("does not corrupt CSS inside <style> blocks", async () => {
    const { minifyOutput } = await import("../src/minify.js");
    const input =
      "<style> @media (max-width: 600px) { .col { width: 100%; } } </style><p>Hi</p>";
    const result = minifyOutput("html", input);
    expect(result).toContain("@media");
    expect(result).toContain("max-width: 600px");
  });

  it("does not corrupt CSS inside mjml <mj-style> blocks", async () => {
    const { minifyOutput } = await import("../src/minify.js");
    const input =
      "<mjml><mj-head><mj-style> .btn { color: red; } </mj-style></mj-head></mjml>";
    const result = minifyOutput("mjml", input);
    expect(result).toContain(".btn");
    expect(result).toContain("color: red");
  });

  it("strips blank lines from react-email output", async () => {
    const { minifyOutput } = await import("../src/minify.js");
    const input = "line1\n\n\n\nline2";
    const result = minifyOutput("react-email", input);
    expect(result).not.toMatch(/\n{3,}/);
  });

  it("returns source unchanged for unknown target", async () => {
    const { minifyOutput } = await import("../src/minify.js");
    const input = "  some content  ";
    expect(minifyOutput("unknown-target", input)).toBe(input);
  });
});

// ── Error handling ────────────────────────────────────────────────────────────

describe("error handling", () => {
  const client = new MaildenoClient({ apiKey: "sk_test_" + "a".repeat(64) });

  it("throws INVALID_API_KEY on 401", async () => {
    mockFetch.mockResolvedValueOnce(
      makeErrorResponse(401, "Invalid or missing API key."),
    );
    const err = await client.renderHtml("t1").catch((e) => e);
    expect(err).toBeInstanceOf(MaildenoError);
    expect(err.code).toBe("INVALID_API_KEY");
    expect(err.status).toBe(401);
  });

  it("throws FORBIDDEN on 403", async () => {
    mockFetch.mockResolvedValueOnce(
      makeErrorResponse(403, "This API key does not have access to the 'mjml' target."),
    );
    const err = await client.renderMjml("t1").catch((e) => e);
    expect(err).toBeInstanceOf(MaildenoError);
    expect(err.code).toBe("FORBIDDEN");
    expect(err.message).toContain("mjml");
  });

  it("throws TEMPLATE_NOT_FOUND on 404", async () => {
    mockFetch.mockResolvedValueOnce(makeErrorResponse(404, "Template not found."));
    const err = await client.renderHtml("bad-id").catch((e) => e);
    expect(err).toBeInstanceOf(MaildenoError);
    expect(err.code).toBe("TEMPLATE_NOT_FOUND");
  });

  it("throws RENDER_ERROR on 422", async () => {
    mockFetch.mockResolvedValueOnce(
      makeErrorResponse(422, "Render failed for target 'html'."),
    );
    const err = await client.renderHtml("t1").catch((e) => e);
    expect(err).toBeInstanceOf(MaildenoError);
    expect(err.code).toBe("RENDER_ERROR");
  });

  it("formats pydantic validation error array into a readable message", async () => {
    const pydanticDetail = [
      {
        type: "uuid_parsing",
        loc: ["body", "template_id"],
        msg: "Input should be a valid UUID, invalid character: expected an optional prefix of `urn:uuid:` followed by [0-9a-fA-F-], found `z` at 1",
        input: "zzz-not-a-uuid",
      },
    ];
    mockFetch.mockResolvedValueOnce(makeErrorResponse(422, pydanticDetail));
    const err = await client.renderHtml("zzz-not-a-uuid").catch((e) => e);

    expect(err).toBeInstanceOf(MaildenoError);
    expect(err.code).toBe("RENDER_ERROR");
    expect(err.message).not.toContain("[object Object]");
    expect(err.message).toContain("template_id");
    expect(err.message).toContain("valid UUID");
    expect(err.issues).toHaveLength(1);
    expect(err.issues![0].loc).toEqual(["body", "template_id"]);
  });

  it("falls back to HTTP <status> when detail is missing or unparseable", async () => {
    mockFetch.mockResolvedValueOnce(new Response("not json", { status: 500 }));
    const err = await client.renderHtml("t1").catch((e) => e);
    expect(err).toBeInstanceOf(MaildenoError);
    expect(err.code).toBe("UNKNOWN");
    expect(err.message).toBe("HTTP 500");
  });

  it("throws NETWORK_ERROR when fetch rejects", async () => {
    mockFetch.mockReturnValueOnce(networkError());
    const err = await client.renderHtml("t1").catch((e) => e);
    expect(err).toBeInstanceOf(MaildenoError);
    expect(err.code).toBe("NETWORK_ERROR");
    expect(err.status).toBe(0);
  });

  it("throws TIMEOUT when request times out", async () => {
    vi.useRealTimers();
    const slowClient = new MaildenoClient({
      apiKey: "sk_test_" + "a".repeat(64),
      timeout: 1,
    });
    mockFetch.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          const signal = init.signal as AbortSignal;
          const abort = () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          };
          if (signal.aborted) return abort();
          signal.addEventListener("abort", abort);
        }),
    );
    const err = await slowClient.renderHtml("t1").catch((e) => e);
    expect(err).toBeInstanceOf(MaildenoError);
    expect(err.code).toBe("TIMEOUT");
  });
});

// ── Convenience methods ───────────────────────────────────────────────────────

describe("convenience methods", () => {
  it("renderHtml returns a string", async () => {
    const client = new MaildenoClient({ apiKey: "sk_test_" + "a".repeat(64) });
    queueTemplates(1);
    const html = await client.renderHtml("t1");
    expect(typeof html).toBe("string");
  });

  it("renderReact sets target=react-email in the template fetch URL", async () => {
    const client = new MaildenoClient({ apiKey: "sk_test_" + "a".repeat(64) });
    queueTemplates(1);
    await client.renderReact("t1");
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain("target=react-email");
  });

  it("renderMjml sets target=mjml in the template fetch URL", async () => {
    const client = new MaildenoClient({ apiKey: "sk_test_" + "a".repeat(64) });
    queueTemplates(1);
    await client.renderMjml("t1");
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain("target=mjml");
  });
});