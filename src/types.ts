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
   * @default 30000
   */
  timeout?: number;

  /**
   * How long a cached template JSON is considered fresh before the SDK
   * attempts a background re-fetch. In milliseconds.
   *
   * After this period the SDK will fetch a fresh copy. If the fetch fails
   * (server down, network error, timeout) the stale copy is used as a
   * fallback so rendering continues uninterrupted.
   *
   * @default 300000  (5 minutes)
   */
  cacheTtl?: number;

  /**
   * Maximum number of template entries to keep in the in-process cache.
   * When the limit is reached the oldest entry is evicted.
   * @default 50
   */
  cacheMaxEntries?: number;
}

// ── Error types ───────────────────────────────────────────────────────────────

export interface ApiErrorBody {
  detail: string;
}

export type SdkErrorCode =
  | "INVALID_API_KEY" // 401 — bad or missing key
  | "FORBIDDEN" // 403 — key lacks scope for the requested target
  | "TEMPLATE_NOT_FOUND" // 404 — templateId not in DB
  | "RENDER_ERROR" // 422 — render failed
  | "NETWORK_ERROR" // fetch() threw
  | "TIMEOUT" // request exceeded timeout
  | "UNKNOWN";
