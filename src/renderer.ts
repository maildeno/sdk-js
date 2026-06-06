// src/renderer.ts
//
// Wasm bridge between the JS SDK and the compiled Rust rendering engine.
//
// State
// ─────
// Currently INACTIVE — _renderLocally() in client.ts uses a stub while the
// Wasm engine is being compiled.
//
// Activation checklist
// ────────────────────
// 1. Run: npm install --save-dev @types/node
// 2. Copy the compiled engine.wasm into src/ next to this file.
// 3. In client.ts → _renderLocally(), uncomment the renderTemplate import
//    and remove the stub block.
// 4. Delete this activation checklist comment.
//
// Memory contract with the Rust engine
// ─────────────────────────────────────
// The Wasm module exports four functions:
//
//   alloc(len: i32) → i32        allocate `len` bytes, return pointer
//   dealloc(ptr: i32, len: i32)  free a previously alloc'd region
//   dealloc_str(ptr: i32)        free a null-terminated result string
//   render(ptr: i32, len: i32) → i32
//       Read `len` bytes of UTF-8 JSON from linear memory at `ptr`,
//       process, write a null-terminated UTF-8 JSON string elsewhere
//       in linear memory, return its pointer.
//
// Input JSON shape  (→ Rust):
//   {
//     "template":     TemplateJson,
//     "target":       "html" | "react-email" | "mjml",
//     "dynamic_data": { merge_tags?: {...}, context?: {...} }
//   }
//
// Output JSON shape (← Rust):
//   { "output": "...rendered string..." }     on success
//   { "error":  "...message..." }             on failure
//
// The minifier runs in TypeScript AFTER the Wasm call — the engine only
// needs to produce correct output; compaction is handled by minify.ts.

// NOTE: renderer.ts requires @types/node for fs/promises, path, url.
// Install when activating: npm install --save-dev @types/node
// The imports below are commented out until then to keep tsc clean.

// import { readFile } from "node:fs/promises";
// import { join } from "node:path";
// import { fileURLToPath } from "node:url";

import { MaildenoError } from "./error.js";
import type { DynamicData, RenderTarget, TemplateJson } from "./types.js";

// ── Wasm instance (singleton, lazy-loaded) ────────────────────────────────────

interface WasmExports {
  memory: WebAssembly.Memory;
  alloc: (len: number) => number;
  dealloc: (ptr: number, len: number) => void;
  dealloc_str: (ptr: number) => void;
  render: (ptr: number, len: number) => number;
}

let _instance: WebAssembly.Instance | null = null;

async function getInstance(): Promise<WebAssembly.Instance> {
  if (_instance) return _instance;

  // Uncomment when @types/node is installed and engine.wasm is in src/:
  //
  // const dir = fileURLToPath(new URL(".", import.meta.url));
  // const wasmPath = join(dir, "engine.wasm");
  // const bytes = await readFile(wasmPath);
  // const { instance } = await WebAssembly.instantiate(bytes, {});
  // _instance = instance;
  // return _instance;

  throw new MaildenoError(
    "RENDER_ERROR",
    "Wasm engine not yet initialised. " +
      "Run the Rust build, copy engine.wasm to src/, then activate renderer.ts.",
  );
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
 * Minification is applied by the caller (client.ts → _renderLocally).
 *
 * @throws {MaildenoError} code "RENDER_ERROR" if the engine reports a failure
 *   or if engine.wasm has not been activated yet.
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
