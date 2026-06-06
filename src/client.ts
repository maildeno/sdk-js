// src/client.ts
import { TemplateCache } from "./cache.js";
import { MaildenoError } from "./error.js";
import { minifyOutput } from "./minify.js";
import type {
  DynamicData,
  MaildenoConfig,
  RenderOptions,
  RenderResult,
  RenderTarget,
  TemplateJson,
} from "./types.js";

const DEFAULT_BASE_URL = "https://api.maildeno.com";
const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_CACHE_TTL = 300_000; // 5 minutes
const DEFAULT_CACHE_MAX = 50;
const TEMPLATE_PATH = "/v1/sdk/template";

/**
 * MaildenoClient
 *
 * Fetches template JSON from the Maildeno API, caches it in-process,
 * and renders the final output locally using the embedded Wasm engine.
 *
 * Stale-on-error fallback
 * -----------------------
 * If a cached template has exceeded its TTL the SDK attempts a fresh fetch.
 * If that fetch fails for any reason (server down, network error, timeout)
 * the stale cached copy is used so rendering continues uninterrupted.
 * `result.fromStaleCache` is set to `true` in that case so you can log it.
 *
 * @example
 * import { MaildenoClient } from "maildeno"
 *
 * const client = new MaildenoClient({ apiKey: "sk_live_..." })
 *
 * const html = await client.renderHtml("550e8400-e29b-41d4-a716-446655440000", {
 *   merge_tags: { text: { name: "Noruwa" } },
 *   context:    { plan: "pro" },
 * })
 */
export class MaildenoClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly cache: TemplateCache;

  constructor(config: MaildenoConfig) {
    if (!config.apiKey) {
      throw new MaildenoError("INVALID_API_KEY", "apiKey is required.");
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
    this.cache = new TemplateCache(
      config.cacheTtl ?? DEFAULT_CACHE_TTL,
      config.cacheMaxEntries ?? DEFAULT_CACHE_MAX,
    );
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Render a template to HTML, React Email TSX, or MJML.
   *
   * Template JSON is fetched once and cached in-process. Subsequent calls
   * with the same templateId render from cache with zero network overhead.
   *
   * If the cache is stale and the server is unreachable the stale copy is
   * used automatically — `result.fromStaleCache` will be `true`.
   *
   * @param options.templateId   UUID of the template (required)
   * @param options.target       "html" | "react-email" | "mjml"  (default: "html")
   * @param options.dynamicData  Merge tags + visibility context (fully optional)
   *
   * @throws {MaildenoError}
   */
  async render(options: RenderOptions): Promise<RenderResult> {
    const { templateId, target = "html", dynamicData } = options;

    const { template, fromStaleCache } = await this._getTemplate(
      templateId,
      target,
    );

    const rawOutput = await this._renderLocally(template, target, dynamicData);
    const output = minifyOutput(target, rawOutput);

    return {
      templateId,
      target,
      output,
      ...(fromStaleCache ? { fromStaleCache: true } : {}),
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

  /**
   * Manually invalidate a cached template.
   *
   * Call this inside your `template.updated` webhook handler so the next
   * render immediately fetches a fresh copy rather than waiting for TTL.
   *
   * @example
   * app.post("/webhooks/maildeno", (req, res) => {
   *   const { event, template_id } = req.body
   *   if (event === "template.updated") {
   *     client.invalidate(template_id)
   *   }
   *   res.sendStatus(200)
   * })
   */
  invalidate(templateId: string): void {
    this.cache.invalidate(templateId);
  }

  /** Wipe the entire in-process template cache. */
  clearCache(): void {
    this.cache.clear();
  }

  // ── Template fetching ───────────────────────────────────────────────────────

  /**
   * Returns a fresh or stale-fallback template for the given id.
   *
   * Priority:
   *   1. Fresh cache hit      → return immediately, no network
   *   2. Cache miss or stale  → attempt GET /v1/sdk/template/{id}
   *      a. Fetch succeeds    → update cache, return fresh template
   *      b. Fetch fails       → if stale copy exists, return it with
   *                             fromStaleCache=true; otherwise re-throw
   */
  private async _getTemplate(
    id: string,
    target: RenderTarget,
  ): Promise<{ template: TemplateJson; fromStaleCache: boolean }> {
    // 1. Fresh hit
    const fresh = this.cache.getFresh(id);
    if (fresh) return { template: fresh, fromStaleCache: false };

    // 2. Miss or stale — try the network
    try {
      const template = await this._get<TemplateJson>(
        `${TEMPLATE_PATH}/${id}?target=${target}`,
      );
      this.cache.set(id, template);
      return { template, fromStaleCache: false };
    } catch (err) {
      // 2b. Network failed — try stale fallback
      const stale = this.cache.getFallback(id);
      if (stale) {
        return { template: stale, fromStaleCache: true };
      }
      // No fallback available — re-throw the original error
      throw err;
    }
  }

  // ── Local rendering (Wasm) ──────────────────────────────────────────────────

  /**
   * Invokes the embedded Wasm rendering engine with the template JSON and
   * dynamic data. Returns the raw (un-minified) output string.
   *
   * NOTE: This method will be replaced by the Wasm bridge once the engine
   * binary is compiled. The interface (in/out) stays identical — only the
   * internals change.
   */
  private async _renderLocally(
    template: TemplateJson,
    target: RenderTarget,
    dynamicData: DynamicData | undefined,
  ): Promise<string> {
    // ── Wasm bridge ───────────────────────────────────────────────────────
    //
    // Uncomment once engine.wasm is compiled and copied into src/:
    //
    //   const { renderTemplate } = await import("./renderer.js");
    //   return renderTemplate(template, target, dynamicData);
    //
    // ─────────────────────────────────────────────────────────────────────
    //
    // Transition stub — serialises the template + dynamic_data payload that
    // the Wasm engine will receive. Replace with the import above once the
    // engine binary is ready. No extra network call is made here.

    void target; // used by Wasm; referenced here to avoid lint warnings
    void dynamicData; // same

    return JSON.stringify({
      __wasm_pending: true,
      template_id: template.template_id,
      template_name: template.template_name,
    });
  }

  // ── HTTP helpers ────────────────────────────────────────────────────────────

  private async _get<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${this.apiKey}` },
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
      let detail: unknown;
      try {
        const json = (await response.json()) as { detail?: unknown };
        detail = json.detail;
      } catch {
        /* ignore */
      }
      throw MaildenoError.fromStatus(response.status, detail);
    }

    return response.json() as Promise<T>;
  }
}
