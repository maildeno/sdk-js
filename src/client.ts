// src/client.ts
import { resolve } from "node:path";
import { TemplateCache, MemoryStore, DiskStore } from "./cache.js";
import { MaildenoError } from "./error.js";
import { minifyOutput } from "./minify.js";
import { renderTemplate } from "./renderer.js";
import type {
  CacheConfig,
  DynamicData,
  MaildenoConfig,
  RenderOptions,
  RenderResult,
  RenderTarget,
  TemplateJson,
} from "./types.js";

const DEFAULT_BASE_URL = "https://api.maildeno.com"; // https://api.maildeno.com change to prod endpoint when published
const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_TTL = 300_000; // 5 minutes
const DEFAULT_MAX = 50;
const DEFAULT_CACHE_PATH = ".maildeno-cache";
const TEMPLATE_PATH = "/v1/sdk/template";

/**
 * MaildenoClient
 *
 * Fetches template JSON from the Maildeno API, caches it locally
 * (memory or disk), and renders the output using the embedded Wasm engine.
 *
 * ## Cache strategies
 *
 * ### Memory (default — zero config)
 * ```ts
 * const client = new MaildenoClient({ apiKey: "sk_live_..." })
 * ```
 *
 * ### Memory with custom settings
 * ```ts
 * const client = new MaildenoClient({
 *   apiKey: "sk_live_...",
 *   cache:  { ttl: 60_000, maxEntries: 20 },
 * })
 * ```
 *
 * ### Disk — survives process restarts
 * ```ts
 * const client = new MaildenoClient({
 *   apiKey: "sk_live_...",
 *   cache: {
 *     type: "disk",
 *     path: "/var/cache/maildeno",  // absolute or relative to cwd
 *     ttl:  300_000,
 *   },
 * })
 * ```
 *
 * ## Stale-on-error fallback
 * When the TTL expires and the server is unreachable, the last known-good
 * cached copy is used and `result.fromStaleCache` is set to `true`.
 *
 * @example
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
    this.cache = MaildenoClient._buildCache(config.cache);
  }

  private static _buildCache(cfg: CacheConfig | undefined): TemplateCache {
    const ttl = cfg?.ttl ?? DEFAULT_TTL;
    const maxEntries = cfg?.maxEntries ?? DEFAULT_MAX;

    if (cfg?.type === "disk") {
      // resolve() turns relative paths into absolute ones using process.cwd()
      // so behaviour is predictable regardless of where the file is imported from.
      const dir = resolve(cfg.path ?? DEFAULT_CACHE_PATH);
      return new TemplateCache(new DiskStore(dir, ttl, maxEntries));
    }

    return new TemplateCache(new MemoryStore(ttl, maxEntries));
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  /**
   * Render a template to HTML, React Email TSX, or MJML.
   *
   * Template JSON is fetched once and cached. Subsequent calls with the same
   * `templateId` render with zero network overhead until the TTL expires.
   *
   * @throws {MaildenoError}
   */
  async render(options: RenderOptions): Promise<RenderResult> {
    const { templateId, target = "html", dynamicData } = options;

    const { template, fromStaleCache } = await this._getTemplate(
      templateId,
      target,
    );

    const rawOutput = await renderTemplate(template, target, dynamicData);
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

  /** Convenience: render to React Email TSX. */
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

  /** Convenience: render to MJML. */
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

  // ── Cache management ────────────────────────────────────────────────────────

  /**
   * List the IDs of all templates currently held in the cache.
   *
   * In memory mode this reads the in-process Map.
   * In disk mode this reads the cache directory — no file contents are loaded.
   *
   * @example
   * const ids = await client.listCached()
   * // ["a7f4b181-a366-4944-a371-e7b941a3c5ab", "9ec0c043-..."]
   */
  async listCached(): Promise<string[]> {
    return this.cache.list();
  }

  /**
   * Remove a single template from the cache by ID.
   *
   * The next render for this template will fetch a fresh copy from the server
   * regardless of TTL. Use this when you know a template has changed and
   * want the update to be visible immediately without waiting for expiry.
   *
   * @example
   * await client.deleteCached("a7f4b181-a366-4944-a371-e7b941a3c5ab")
   */
  async deleteCached(templateId: string): Promise<void> {
    await this.cache.invalidate(templateId);
  }

  /**
   * Remove all templates from the cache.
   *
   * In memory mode this empties the in-process Map.
   * In disk mode this deletes all `.json` files in the cache directory —
   * the directory itself is left intact.
   */
  async clearCache(): Promise<void> {
    await this.cache.clear();
  }

  /**
   * @deprecated Use `deleteCached(templateId)` instead.
   * Delegates to `deleteCached` — existing code continues to work.
   */
  async invalidate(templateId: string): Promise<void> {
    await this.deleteCached(templateId);
  }

  // ── Template fetching ───────────────────────────────────────────────────────

  private async _getTemplate(
    id: string,
    target: RenderTarget,
  ): Promise<{ template: TemplateJson; fromStaleCache: boolean }> {
    // 1. Fresh hit — no network needed
    const fresh = await this.cache.getFresh(id);
    if (fresh) return { template: fresh, fromStaleCache: false };

    // 2. Miss or stale — try the network
    try {
      const template = await this._get<TemplateJson>(
        `${TEMPLATE_PATH}/${id}?target=${target}`,
      );
      await this.cache.set(id, template);
      return { template, fromStaleCache: false };
    } catch (err) {
      // 3. Network failed — use stale copy if we have one
      const stale = await this.cache.getFallback(id);
      if (stale) return { template: stale, fromStaleCache: true };
      // No cached copy at all — re-throw so the caller knows
      throw err;
    }
  }

  // ── HTTP ────────────────────────────────────────────────────────────────────

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
