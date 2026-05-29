// src/types.ts
// ─────────────────────────────────────────────────────────────────────────────
// All public types for the Maildeno SDK.
// ─────────────────────────────────────────────────────────────────────────────

// ── Render target ─────────────────────────────────────────────────────────────

export type RenderTarget = "html" | "react-email" | "mjml";

// ── Dynamic data — all fields optional ───────────────────────────────────────
//
// Pass only what you need. Everything defaults to {}.
//
// Examples:
//   {}                                         — no merge tags, no context
//   { merge_tags: { text: { name: "Noruwa" } } }
//   { context: { plan: "pro" } }
//   { merge_tags: { text: {...}, url: {...} }, context: { country: "usa" } }

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
}

// ── Error types ───────────────────────────────────────────────────────────────

export interface ApiErrorBody {
  detail: string;
}

export type SdkErrorCode =
  | "INVALID_API_KEY" // 401 — bad or missing key
  | "FORBIDDEN" // 403 — key lacks scope for the requested target
  | "TEMPLATE_NOT_FOUND" // 404 — templateId not in DB
  | "RENDER_ERROR" // 422 — SDK builder failed
  | "NETWORK_ERROR" // fetch() threw
  | "TIMEOUT" // request exceeded timeout
  | "UNKNOWN";
