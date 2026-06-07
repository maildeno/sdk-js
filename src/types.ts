// src/types.ts
// ─────────────────────────────────────────────────────────────────────────────
// All public types for the Maildeno SDK.
// ─────────────────────────────────────────────────────────────────────────────

// ── Render target ─────────────────────────────────────────────────────────────

export type RenderTarget = "html" | "react-email" | "mjml";

// ── Dynamic data — all fields optional ───────────────────────────────────────

export interface MergeTagGroup {
  /** Resolved into paragraph / heading / list / button text */
  text?: Record<string, string>;
  /** Resolved into href / src attributes — values are URL-encoded */
  url?: Record<string, string>;
  /** Resolved into HTML attribute values — values are HTML-escaped */
  attr?: Record<string, string>;
}

export interface DynamicData {
  /** Merge tag values, split by type. All sub-groups are optional. */
  merge_tags?: MergeTagGroup;
  /** Runtime context used for visibility rules (show/hide rows). */
  context?: Record<string, string | number | boolean>;
}

// ── Template JSON returned by GET /v1/sdk/template/{id} ──────────────────────

export interface TemplateJson {
  template_id: string;
  template_name: string;
  /** Canvas-level settings (global padding, background colour, etc.) */
  canvas: Record<string, unknown>;
  /** Ordered list of row definitions */
  rows: unknown[];
  /** Schema version — used to guard against breaking changes */
  schema_version: string;
}

// ── Render request / response ─────────────────────────────────────────────────

export interface RenderOptions {
  /** UUID of the template stored in Maildeno. */
  templateId: string;
  /** Output format. Defaults to "html". */
  target?: RenderTarget;
  /** Dynamic data. Fully optional — omit entirely if not needed. */
  dynamicData?: DynamicData;
}

export interface RenderResult {
  templateId: string;
  target: RenderTarget;
  /** The rendered output string (HTML, TSX, or MJML). */
  output: string;
  /**
   * True when the template was served from a stale cache entry because
   * the Maildeno server could not be reached. The output is still valid —
   * this flag exists so callers can log or alert if desired.
   */
  fromStaleCache?: boolean;
}

// ── Cache configuration ───────────────────────────────────────────────────────

export interface CacheConfig {
  /**
   * Storage strategy.
   *
   * - `"memory"` (default) — in-process Map. Fast, zero I/O, lost on restart.
   * - `"disk"`   — persistent JSON files on the local filesystem.
   *                Survives server restarts. The user explicitly opts in and
   *                is responsible for the path they supply.
   */
  type?: "memory" | "disk";

  /**
   * Directory used when `type: "disk"`.
   * Created automatically if it does not exist.
   *
   * Accepts absolute paths (`/var/cache/maildeno`) or relative ones
   * (`".maildeno-cache"` — resolved against `process.cwd()`).
   *
   * @default ".maildeno-cache"
   */
  path?: string;

  /**
   * How long a cached template is considered fresh (milliseconds).
   * After this period the SDK attempts a background re-fetch.
   * If the re-fetch fails the stale copy is returned as a fallback.
   *
   * @default 300_000  (5 minutes)
   */
  ttl?: number;

  /**
   * Maximum number of template entries to hold in the cache.
   * When the limit is reached the oldest entry is evicted.
   *
   * @default 50
   */
  maxEntries?: number;
}

// ── Client config ─────────────────────────────────────────────────────────────

export interface MaildenoConfig {
  /**
   * Your Maildeno API key.
   * Format: sk_live_<64hex>  (production)
   *         sk_test_<64hex>  (development)
   *
   * Obtain from: Dashboard → API Keys → Create Key
   */
  apiKey: string;

  /**
   * Base URL of your Maildeno API.
   * @default "https://api.maildeno.com"
   */
  baseUrl?: string;

  /**
   * Request timeout in milliseconds.
   * @default 30_000
   */
  timeout?: number;

  /**
   * Cache configuration.
   * Omit to use memory caching with default settings.
   *
   * @example Memory with custom TTL
   * cache: { ttl: 60_000 }
   *
   * @example Persistent disk cache
   * cache: { type: "disk", path: "/var/cache/maildeno", ttl: 300_000 }
   */
  cache?: CacheConfig;
}

// ── Error types ───────────────────────────────────────────────────────────────

export interface ApiErrorBody {
  detail: string;
}

export type SdkErrorCode =
  | "INVALID_API_KEY" // 401 — bad or missing key
  | "FORBIDDEN" // 403 — key lacks scope for target, OR plan limit reached
  | "TEMPLATE_NOT_FOUND" // 404 — templateId not in DB
  | "RENDER_ERROR" // 422 — render failed
  | "NETWORK_ERROR" // fetch() threw
  | "TIMEOUT" // request exceeded timeout
  | "UNKNOWN";
