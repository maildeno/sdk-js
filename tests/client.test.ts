// tests/client.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MaildenoClient } from "../src/client.js";
import { MaildenoError } from "../src/error.js";

// ── Mock fetch ────────────────────────────────────────────────────────────────

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  mockFetch.mockReset();
});

function okResponse(body: object) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function errorResponse(status: number, detail: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify({ detail }), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

// ── Constructor ───────────────────────────────────────────────────────────────

describe("MaildenoClient constructor", () => {
  it("throws if apiKey is missing", () => {
    expect(() => new MaildenoClient({ apiKey: "" })).toThrow(MaildenoError);
  });

  it("strips trailing slash from baseUrl", async () => {
    mockFetch.mockReturnValue(
      okResponse({
        template_id: "abc",
        target: "html",
        output: "<html/>",
      }),
    );
    const client = new MaildenoClient({
      apiKey: "sk_test_" + "a".repeat(64),
      baseUrl: "https://api.example.com/",
    });
    await client.renderHtml("abc");
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe("https://api.example.com/v1/sdk/render");
  });

  it("defaults to https://api.maildeno.com when baseUrl not provided", async () => {
    mockFetch.mockReturnValue(
      okResponse({
        template_id: "abc",
        target: "html",
        output: "<html/>",
      }),
    );
    const client = new MaildenoClient({ apiKey: "sk_test_" + "a".repeat(64) });
    await client.renderHtml("abc");
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe("https://api.maildeno.com/v1/sdk/render");
  });
});

// ── render() ──────────────────────────────────────────────────────────────────

describe("render()", () => {
  const client = new MaildenoClient({
    apiKey: "sk_test_" + "a".repeat(64),
    baseUrl: "https://api.maildeno.com",
  });

  it("sends Authorization: Bearer header", async () => {
    mockFetch.mockReturnValue(
      okResponse({
        template_id: "t1",
        target: "html",
        output: "<p>Hi</p>",
      }),
    );
    await client.render({ templateId: "t1" });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer sk_test_" + "a".repeat(64),
    );
  });

  it("defaults target to html", async () => {
    mockFetch.mockReturnValue(
      okResponse({
        template_id: "t1",
        target: "html",
        output: "<p/>",
      }),
    );
    await client.render({ templateId: "t1" });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.target).toBe("html");
  });

  it("omits dynamic_data key when not provided", async () => {
    mockFetch.mockReturnValue(
      okResponse({
        template_id: "t1",
        target: "html",
        output: "<p/>",
      }),
    );
    await client.render({ templateId: "t1" });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.dynamic_data).toBeUndefined();
  });

  it("includes only provided merge_tag sub-groups", async () => {
    mockFetch.mockReturnValue(
      okResponse({
        template_id: "t1",
        target: "html",
        output: "<p>Noruwa</p>",
      }),
    );
    await client.render({
      templateId: "t1",
      dynamicData: { merge_tags: { text: { name: "Noruwa" } } },
    });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.dynamic_data.merge_tags.text).toEqual({ name: "Noruwa" });
    expect(body.dynamic_data.merge_tags.url).toBeUndefined();
    expect(body.dynamic_data.merge_tags.attr).toBeUndefined();
  });

  it("includes context when provided", async () => {
    mockFetch.mockReturnValue(
      okResponse({
        template_id: "t1",
        target: "html",
        output: "<p/>",
      }),
    );
    await client.render({
      templateId: "t1",
      dynamicData: { context: { plan: "pro", country: "usa" } },
    });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.dynamic_data.context).toEqual({ plan: "pro", country: "usa" });
  });

  it("omits dynamic_data entirely when all sub-groups are empty", async () => {
    mockFetch.mockReturnValue(
      okResponse({
        template_id: "t1",
        target: "html",
        output: "<p/>",
      }),
    );
    await client.render({
      templateId: "t1",
      dynamicData: { merge_tags: {}, context: {} },
    });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.dynamic_data).toBeUndefined();
  });

  it("maps response correctly", async () => {
    mockFetch.mockReturnValue(
      okResponse({
        template_id: "t1",
        target: "react-email",
        output: "export default function...",
      }),
    );
    const result = await client.render({
      templateId: "t1",
      target: "react-email",
    });
    expect(result.templateId).toBe("t1");
    expect(result.target).toBe("react-email");
    expect(result.output).toBe("export default function...");
  });
});

// ── Convenience methods ───────────────────────────────────────────────────────

describe("convenience methods", () => {
  const client = new MaildenoClient({ apiKey: "sk_test_" + "a".repeat(64) });

  it("renderHtml returns output string", async () => {
    mockFetch.mockReturnValue(
      okResponse({
        template_id: "t1",
        target: "html",
        output: "<html>...</html>",
      }),
    );
    const html = await client.renderHtml("t1");
    expect(html).toBe("<html>...</html>");
  });

  it("renderReact sets target to react-email", async () => {
    mockFetch.mockReturnValue(
      okResponse({
        template_id: "t1",
        target: "react-email",
        output: "tsx...",
      }),
    );
    await client.renderReact("t1");
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).target).toBe("react-email");
  });

  it("renderMjml sets target to mjml", async () => {
    mockFetch.mockReturnValue(
      okResponse({
        template_id: "t1",
        target: "mjml",
        output: "<mjml>...</mjml>",
      }),
    );
    await client.renderMjml("t1");
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).target).toBe("mjml");
  });
});

// ── Error handling ────────────────────────────────────────────────────────────

describe("error handling", () => {
  const client = new MaildenoClient({ apiKey: "sk_test_" + "a".repeat(64) });

  it("throws INVALID_API_KEY on 401", async () => {
    mockFetch.mockReturnValue(
      errorResponse(401, "Invalid or missing API key."),
    );
    const err = await client.render({ templateId: "t1" }).catch((e) => e);
    expect(err).toBeInstanceOf(MaildenoError);
    expect(err.code).toBe("INVALID_API_KEY");
    expect(err.status).toBe(401);
  });

  it("throws FORBIDDEN on 403", async () => {
    mockFetch.mockReturnValue(
      errorResponse(
        403,
        "This API key does not have access to the 'mjml' target.",
      ),
    );
    const err = await client.renderMjml("t1").catch((e) => e);
    expect(err).toBeInstanceOf(MaildenoError);
    expect(err.code).toBe("FORBIDDEN");
    expect(err.status).toBe(403);
    expect(err.message).toContain("mjml");
  });

  it("throws TEMPLATE_NOT_FOUND on 404", async () => {
    mockFetch.mockReturnValue(errorResponse(404, "Template not found."));
    const err = await client.renderHtml("bad-id").catch((e) => e);
    expect(err).toBeInstanceOf(MaildenoError);
    expect(err.code).toBe("TEMPLATE_NOT_FOUND");
    expect(err.status).toBe(404);
  });

  it("throws RENDER_ERROR on 422", async () => {
    mockFetch.mockReturnValue(
      errorResponse(422, "Render failed for target 'html'."),
    );
    const err = await client.renderHtml("t1").catch((e) => e);
    expect(err).toBeInstanceOf(MaildenoError);
    expect(err.code).toBe("RENDER_ERROR");
  });

  it("formats pydantic validation error array into a readable message", async () => {
    // FastAPI returns this shape when template_id fails UUID validation
    const pydanticDetail = [
      {
        type: "uuid_parsing",
        loc: ["body", "template_id"],
        msg: "Input should be a valid UUID, invalid character: expected an optional prefix of `urn:uuid:` followed by [0-9a-fA-F-], found `z` at 1",
        input: "zzz-not-a-uuid",
      },
    ];
    mockFetch.mockReturnValue(errorResponse(422, pydanticDetail));
    const err = await client.renderHtml("zzz-not-a-uuid").catch((e) => e);

    expect(err).toBeInstanceOf(MaildenoError);
    expect(err.code).toBe("RENDER_ERROR");
    expect(err.status).toBe(422);
    // No more "[object Object]" — message should be a real sentence.
    expect(err.message).not.toContain("[object Object]");
    expect(err.message).toContain("template_id");
    expect(err.message).toContain("valid UUID");
    // Structured issues should be available for programmatic inspection.
    expect(err.issues).toHaveLength(1);
    expect(err.issues![0].loc).toEqual(["body", "template_id"]);
  });

  it("joins multiple pydantic issues with semicolons", async () => {
    const pydanticDetail = [
      { type: "missing", loc: ["body", "template_id"], msg: "Field required" },
      {
        type: "string_type",
        loc: ["body", "target"],
        msg: "Input should be a string",
      },
    ];
    mockFetch.mockReturnValue(errorResponse(422, pydanticDetail));
    const err = await client.renderHtml("t1").catch((e) => e);
    expect(err.message).toBe(
      "template_id: Field required; target: Input should be a string",
    );
    expect(err.issues).toHaveLength(2);
  });

  it("falls back to HTTP <status> when detail is missing or unparseable", async () => {
    mockFetch.mockReturnValue(
      Promise.resolve(new Response("not json", { status: 500 })),
    );
    const err = await client.renderHtml("t1").catch((e) => e);
    expect(err).toBeInstanceOf(MaildenoError);
    expect(err.code).toBe("UNKNOWN");
    expect(err.message).toBe("HTTP 500");
    expect(err.issues).toBeUndefined();
  });

  it("falls back to HTTP <status> when detail is null", async () => {
    mockFetch.mockReturnValue(errorResponse(500, null));
    const err = await client.renderHtml("t1").catch((e) => e);
    expect(err.message).toBe("HTTP 500");
  });

  it("throws NETWORK_ERROR when fetch rejects", async () => {
    mockFetch.mockRejectedValue(new Error("Failed to fetch"));
    const err = await client.renderHtml("t1").catch((e) => e);
    expect(err).toBeInstanceOf(MaildenoError);
    expect(err.code).toBe("NETWORK_ERROR");
    expect(err.status).toBe(0);
  });

  it("throws TIMEOUT when request times out", async () => {
    const slowClient = new MaildenoClient({
      apiKey: "sk_test_" + "a".repeat(64),
      timeout: 1,
    });
    // Mimic real fetch: reject with an AbortError when the signal aborts.
    mockFetch.mockImplementation(
      (_url, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          const signal = init.signal as AbortSignal;
          if (signal.aborted) {
            const err = new Error("aborted");
            err.name = "AbortError";
            return reject(err);
          }
          signal.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );
    const err = await slowClient.renderHtml("t1").catch((e) => e);
    expect(err).toBeInstanceOf(MaildenoError);
    expect(err.code).toBe("TIMEOUT");
  });
});
