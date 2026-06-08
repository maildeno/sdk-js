// src/renderer.ts
//
// Wasm bridge between the JS SDK and the compiled Rust rendering engine.
//
// Memory contract with the Rust engine
// ─────────────────────────────────────
//   alloc(len: i32) → i32          allocate `len` bytes, return pointer
//   dealloc(ptr: i32, len: i32)    free a previously alloc'd region
//   dealloc_str(ptr: i32)          free a null-terminated result string
//   render(ptr: i32, len: i32) → i32
//       Read `len` bytes of UTF-8 JSON from linear memory at `ptr`,
//       process, write a null-terminated UTF-8 JSON string elsewhere
//       in linear memory, return its pointer.
//   heap_peak() → i32
//       Return the peak heap bytes used since the last render call start.
//       Used for profiling — safe to call after every render().
//
// Input JSON shape  (→ Rust):
//   {
//     "template":     TemplateJson,
//     "target":       "html" | "react-email" | "mjml",
//     "dynamic_data": { merge_tags?: {...}, context?: {...} }
//   }
//
// Output JSON shape (← Rust):
//   { "output": "...rendered string..." }   on success
//   { "error":  "...message..." }           on failure

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { MaildenoError } from "./error.js";
import type { DynamicData, RenderTarget, TemplateJson } from "./types.js";

// ── Wasm instance (singleton, lazy-loaded) ────────────────────────────────────

interface WasmExports {
  memory: WebAssembly.Memory;
  alloc: (len: number) => number;
  dealloc: (ptr: number, len: number) => void;
  dealloc_str: (ptr: number) => void;
  render: (ptr: number, len: number) => number;
  heap_peak: () => number;
}

let _instance: WebAssembly.Instance | null = null;

async function getInstance(): Promise<WebAssembly.Instance> {
  if (_instance) return _instance;

  // Resolve the directory that contains the *compiled* JS file at runtime.
  //
  // tsup outputs both ESM (index.mjs) and CJS (index.js) into dist/.
  // engine.wasm is copied into dist/ alongside them by tsup.config.ts.
  //
  //   ESM  → import.meta.url is defined, e.g. file:///…/dist/index.mjs
  //   CJS  → import.meta.url is undefined; use __filename instead
  //
  // We detect the format at runtime to get the correct directory in both cases.
  const dir =
    typeof __filename !== "undefined"
      ? // CJS runtime — __filename / __dirname are injected by Node
        join(__filename, "..")
      : // ESM runtime — use import.meta.url
        join(fileURLToPath(import.meta.url), "..");

  const wasmPath = join(dir, "engine.wasm");

  let bytes: Buffer;
  try {
    bytes = await readFile(wasmPath);
  } catch (cause) {
    throw new MaildenoError(
      "RENDER_ERROR",
      `Could not load engine.wasm from ${wasmPath}. ` +
        `Make sure engine.wasm is in the same directory as the compiled JS. ` +
        `Original error: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  const { instance } = await WebAssembly.instantiate(bytes, {});
  _instance = instance;
  return _instance;
}

// ── String helpers ────────────────────────────────────────────────────────────

function writeString(
  memory: WebAssembly.Memory,
  ptr: number,
  str: string,
): void {
  const encoded = new TextEncoder().encode(str);
  new Uint8Array(memory.buffer).set(encoded, ptr);
}

function readCString(memory: WebAssembly.Memory, ptr: number): string {
  const buf = new Uint8Array(memory.buffer);
  let end = ptr;
  while (buf[end] !== 0) end++;
  return new TextDecoder().decode(buf.subarray(ptr, end));
}

// ── Public render function ────────────────────────────────────────────────────

/**
 * Render a template using the embedded Wasm engine.
 * Returns the raw (un-minified) output string.
 * Minification is applied by the caller (client.ts).
 *
 * @throws {MaildenoError} with code "RENDER_ERROR" if the engine reports a
 *   failure or if engine.wasm cannot be found or loaded.
 */
export async function renderTemplate(
  template: TemplateJson,
  target: RenderTarget,
  dynamicData: DynamicData | undefined,
): Promise<string> {
  const instance = await getInstance();
  const exports = instance.exports as unknown as WasmExports;
  const memory = exports.memory;

  const input = JSON.stringify({
    template,
    target,
    dynamic_data: dynamicData ?? {},
  });

  const encoded = new TextEncoder().encode(input);
  const inputLen = encoded.length;

  const inputPtr = exports.alloc(inputLen);
  writeString(memory, inputPtr, input);

  const resultPtr = exports.render(inputPtr, inputLen);
  exports.dealloc(inputPtr, inputLen);

  // Only log when approaching the heap ceiling (>75% of 12 MB), heap size for template rendering are normally less than 2 MB. Headroom over worst case - 5.5×
  const peakBytes = exports.heap_peak();
  if (peakBytes > 9 * 1024 * 1024) {
    console.warn(
      `[maildeno-engine] heap usage high: ${(peakBytes / 1024 / 1024).toFixed(2)} MB` +
        `  target=${target}`,
    );
  }
  // ─────────────────────────────────────────────────────────────────────────

  const resultJson = readCString(memory, resultPtr);
  exports.dealloc_str(resultPtr);

  let parsed: { output?: string; error?: string };
  try {
    parsed = JSON.parse(resultJson) as { output?: string; error?: string };
  } catch {
    throw new MaildenoError(
      "RENDER_ERROR",
      `Engine returned non-JSON: ${resultJson.slice(0, 120)}`,
    );
  }

  if (parsed.error) {
    throw new MaildenoError("RENDER_ERROR", parsed.error);
  }

  if (typeof parsed.output !== "string") {
    throw new MaildenoError(
      "RENDER_ERROR",
      "Engine response missing 'output' field.",
    );
  }

  return parsed.output;
}
