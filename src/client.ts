// src/client.ts
import { MaildenoError } from "./error.js";
import type {
  DynamicData,
  MaildenoConfig,
  RenderOptions,
  RenderResult,
  RenderTarget,
} from "./types.js";

const DEFAULT_BASE_URL = "https://api.maildeno.com";
const DEFAULT_TIMEOUT = 30_000;
const RENDER_PATH = "/v1/sdk/render";

/**
 * MaildenoClient
 *
 * The main entry point for the Maildeno SDK.
 *
 * @example
 * import { MaildenoClient } from "maildeno"
 *
 * const client = new MaildenoClient({
 *   apiKey:  "sk_live_4a7f2c8d...",
 *   baseUrl: "https://api.maildeno.com", // optional, defaults to https://api.maildeno.com
 * })
 *
 * const result = await client.render({
 *   templateId: "550e8400-e29b-41d4-a716-446655440000",
 *   target:     "html",
 *   dynamicData: {
 *     merge_tags: { text: { name: "Noruwa" } },
 *     context:    { plan: "pro" },
 *   },
 * })
 *
 * console.log(result.output) // full HTML string
 */
export class MaildenoClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;

  constructor(config: MaildenoConfig) {
    if (!config.apiKey) {
      throw new MaildenoError("INVALID_API_KEY", "apiKey is required.");
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Render a template to HTML, React Email TSX, or MJML.
   *
   * @param options.templateId   UUID of the template (required)
   * @param options.target       "html" | "react-email" | "mjml"  (default: "html")
   * @param options.dynamicData  Merge tags + visibility context (fully optional)
   *
   * @throws {MaildenoError}
   */
  async render(options: RenderOptions): Promise<RenderResult> {
    const { templateId, target = "html", dynamicData } = options;

    const normalised = dynamicData
      ? normaliseDynamicData(dynamicData)
      : undefined;

    const body: Record<string, unknown> = {
      template_id: templateId,
      target,
    };

    // Only include dynamic_data if there's actually something to send.
    if (normalised && Object.keys(normalised).length > 0) {
      body.dynamic_data = normalised;
    }

    const raw = await this._post<{
      template_id: string;
      target: RenderTarget;
      output: string;
    }>(RENDER_PATH, body);

    return {
      templateId: raw.template_id,
      target: raw.target,
      output: raw.output,
    };
  }

  /**
   * Convenience: render to HTML.
   *
   * @example
   * const html = await client.renderHtml("550e8400-...", {
   *   merge_tags: { text: { name: "Noruwa" } },
   * })
   */
  async renderHtml(
    templateId: string,
    dynamicData?: DynamicData,
  ): Promise<string> {
    const { output } = await this.render({
      templateId,
      target: "html",
      dynamicData,
    });
    return output;
  }

  /**
   * Convenience: render to React Email TSX.
   */
  async renderReact(
    templateId: string,
    dynamicData?: DynamicData,
  ): Promise<string> {
    const { output } = await this.render({
      templateId,
      target: "react-email",
      dynamicData,
    });
    return output;
  }

  /**
   * Convenience: render to MJML.
   */
  async renderMjml(
    templateId: string,
    dynamicData?: DynamicData,
  ): Promise<string> {
    const { output } = await this.render({
      templateId,
      target: "mjml",
      dynamicData,
    });
    return output;
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private async _post<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new MaildenoError(
          "TIMEOUT",
          `Request timed out after ${this.timeout}ms`,
        );
      }
      throw new MaildenoError(
        "NETWORK_ERROR",
        err instanceof Error ? err.message : "Network request failed",
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      let detail: unknown = undefined;
      try {
        const json = (await response.json()) as { detail?: unknown };
        detail = json.detail;
      } catch {
        // ignore JSON parse errors on error responses — fromStatus will fall
        // back to a generic "HTTP <status>" message.
      }
      throw MaildenoError.fromStatus(response.status, detail);
    }

    return response.json() as Promise<T>;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Normalise caller-provided dynamicData into the exact shape the API expects.
 * All fields are optional — we only include keys the caller provided.
 */
function normaliseDynamicData(data: DynamicData): Record<string, unknown> {
  const merge_tags: Record<string, Record<string, string>> = {};

  if (data.merge_tags?.text && Object.keys(data.merge_tags.text).length > 0) {
    merge_tags.text = data.merge_tags.text;
  }
  if (data.merge_tags?.url && Object.keys(data.merge_tags.url).length > 0) {
    merge_tags.url = data.merge_tags.url;
  }
  if (data.merge_tags?.attr && Object.keys(data.merge_tags.attr).length > 0) {
    merge_tags.attr = data.merge_tags.attr;
  }

  const result: Record<string, unknown> = {};

  if (Object.keys(merge_tags).length > 0) {
    result.merge_tags = merge_tags;
  }
  if (data.context && Object.keys(data.context).length > 0) {
    result.context = data.context;
  }

  return result;
}
