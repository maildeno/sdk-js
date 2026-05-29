// src/error.ts
import type { SdkErrorCode } from "./types.js";

/**
 * Shape of validation error, as returned in
 * the `detail` array of a 422 response.
 *
 * Example:
 *   {
 *     type: "uuid_parsing",
 *     loc:  ["body", "template_id"],
 *     msg:  "Input should be a valid UUID, ...",
 *     input: "not-a-uuid",
 *   }
 */
export interface ValidationIssue {
  type: string;
  loc: (string | number)[];
  msg: string;
  input?: unknown;
  // include other fields (ctx, url, ...) — keep open.
  [key: string]: unknown;
}

/**
 * All errors thrown by the Maildeno SDK are instances of MaildenoError.
 *
 * @example
 * try {
 *   await client.render({ templateId: "..." })
 * } catch (err) {
 *   if (err instanceof MaildenoError) {
 *     console.error(err.code, err.message, err.status)
 *     // For validation errors (422 from malformed input), inspect err.issues
 *     if (err.issues) console.error(err.issues)
 *   }
 * }
 */
export class MaildenoError extends Error {
  /** Machine-readable error code */
  readonly code: SdkErrorCode;
  /** HTTP status code (0 for network / timeout errors) */
  readonly status: number;
  /**
   * Structured validation issues, when the API returned a list of
   * errors (422 from malformed request data, e.g. a non-UUID template_id).
   * Undefined for all other error shapes.
   */
  readonly issues?: ValidationIssue[];

  constructor(
    code: SdkErrorCode,
    message: string,
    status = 0,
    issues?: ValidationIssue[],
  ) {
    super(message);
    this.name = "MaildenoError";
    this.code = code;
    this.status = status;
    if (issues) this.issues = issues;
    // Maintains proper prototype chain in transpiled ES5
    Object.setPrototypeOf(this, MaildenoError.prototype);
  }

  /**
   * Build a MaildenoError from an HTTP status and the raw `detail` field
   * from the API response. `detail` may be:
   *   - a string  (HTTPException — custom 401/403/404 messages)
   *   - an array  (RequestValidationError — list of issues)
   *   - missing   (handled by caller — pass `undefined`)
   */
  static fromStatus(status: number, detail: unknown): MaildenoError {
    const codeMap: Record<number, SdkErrorCode> = {
      401: "INVALID_API_KEY",
      403: "FORBIDDEN",
      404: "TEMPLATE_NOT_FOUND",
      422: "RENDER_ERROR",
    };
    const code = codeMap[status] ?? "UNKNOWN";
    const { message, issues } = formatDetail(detail, status);
    return new MaildenoError(code, message, status, issues);
  }
}

/**
 * Normalise the `detail` field from error response into a
 * human-readable message and an optional structured issues array.
 */
function formatDetail(
  detail: unknown,
  status: number,
): { message: string; issues?: ValidationIssue[] } {
  // String — HTTPException("...") path. Use as-is.
  if (typeof detail === "string" && detail.length > 0) {
    return { message: detail };
  }

  // Array — RequestValidationError path. Each entry has msg + loc.
  if (
    Array.isArray(detail) &&
    detail.length > 0 &&
    isValidationIssueArray(detail)
  ) {
    const issues = detail as ValidationIssue[];
    const message = issues
      .map((issue) => {
        // loc is like ["body", "template_id"] — drop the leading "body"
        // since it's noise to API consumers.
        const path = issue.loc
          .filter((p, i) => !(i === 0 && p === "body"))
          .join(".");
        return path ? `${path}: ${issue.msg}` : issue.msg;
      })
      .join("; ");
    return { message, issues };
  }

  // Object / null / undefined — fall back to a status-based message.
  return { message: `HTTP ${status}` };
}

function isValidationIssueArray(arr: unknown[]): boolean {
  return arr.every(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as { msg?: unknown }).msg === "string",
  );
}
