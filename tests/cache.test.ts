// tests/cache.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryStore, DiskStore, TemplateCache } from "../src/cache.js";
import type { TemplateJson } from "../src/types.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TEMPLATE: TemplateJson = {
  template_id: "a7f4b181-a366-4944-a371-e7b941a3c5ab",
  template_name: "Test Template",
  canvas: {},
  rows: [],
  schema_version: "1.0",
};

const ID = "a7f4b181-a366-4944-a371-e7b941a3c5ab";

// ══════════════════════════════════════════════════════════════════════════════
// MemoryStore
// ══════════════════════════════════════════════════════════════════════════════

describe("MemoryStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null on fresh miss", () => {
    const store = new MemoryStore(300_000, 50);
    expect(store.getFresh(ID)).toBeNull();
  });

  it("returns template on fresh hit", () => {
    const store = new MemoryStore(300_000, 50);
    store.set(ID, TEMPLATE);
    expect(store.getFresh(ID)).toEqual(TEMPLATE);
  });

  it("returns null when entry is stale", () => {
    const store = new MemoryStore(1_000, 50);
    store.set(ID, TEMPLATE);
    vi.advanceTimersByTime(2_000);
    expect(store.getFresh(ID)).toBeNull();
  });

  it("getFallback returns stale entry", () => {
    const store = new MemoryStore(1_000, 50);
    store.set(ID, TEMPLATE);
    vi.advanceTimersByTime(2_000);
    expect(store.getFallback(ID)).toEqual(TEMPLATE);
  });

  it("getFallback returns null when never set", () => {
    const store = new MemoryStore(300_000, 50);
    expect(store.getFallback(ID)).toBeNull();
  });

  it("invalidate removes entry", () => {
    const store = new MemoryStore(300_000, 50);
    store.set(ID, TEMPLATE);
    store.invalidate(ID);
    expect(store.getFresh(ID)).toBeNull();
    expect(store.getFallback(ID)).toBeNull();
  });

  it("invalidate on missing id is a no-op", () => {
    const store = new MemoryStore(300_000, 50);
    expect(() => store.invalidate("does-not-exist")).not.toThrow();
  });

  it("clear removes all entries", () => {
    const store = new MemoryStore(300_000, 50);
    store.set("id-1", TEMPLATE);
    store.set("id-2", TEMPLATE);
    store.clear();
    expect(store.list()).toHaveLength(0);
  });

  it("list returns all stored IDs", () => {
    const store = new MemoryStore(300_000, 50);
    store.set("id-1", TEMPLATE);
    store.set("id-2", TEMPLATE);
    expect(store.list()).toContain("id-1");
    expect(store.list()).toContain("id-2");
  });

  it("evicts oldest entry when maxEntries is reached", () => {
    const store = new MemoryStore(300_000, 2);

    store.set("id-1", TEMPLATE);
    vi.advanceTimersByTime(10);
    store.set("id-2", TEMPLATE);
    vi.advanceTimersByTime(10);

    // Adding id-3 should evict id-1 (oldest)
    store.set("id-3", TEMPLATE);

    expect(store.getFallback("id-1")).toBeNull(); // evicted
    expect(store.getFallback("id-2")).not.toBeNull();
    expect(store.getFallback("id-3")).not.toBeNull();
  });

  it("updating an existing key does not trigger eviction", () => {
    const store = new MemoryStore(300_000, 2);
    store.set("id-1", TEMPLATE);
    store.set("id-2", TEMPLATE);
    // Update id-1 — size stays at 2, no eviction
    store.set("id-1", { ...TEMPLATE, template_name: "Updated" });
    expect(store.list()).toHaveLength(2);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// DiskStore
// ══════════════════════════════════════════════════════════════════════════════

describe("DiskStore", () => {
  let tmpDir: string;

  beforeEach(async () => {
    vi.useFakeTimers({ now: Date.now() });
    // Create a fresh temp directory for each test
    tmpDir = await mkdtemp(join(tmpdir(), "maildeno-cache-test-"));
  });

  afterEach(async () => {
    vi.useRealTimers();
    // Clean up temp directory
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ── Reads ──────────────────────────────────────────────────────────────────

  it("getFresh returns null on miss (no file)", async () => {
    const store = new DiskStore(tmpDir, 300_000, 50);
    expect(await store.getFresh(ID)).toBeNull();
  });

  it("getFresh returns template when file exists and is fresh", async () => {
    const store = new DiskStore(tmpDir, 300_000, 50);
    await store.set(ID, TEMPLATE);
    expect(await store.getFresh(ID)).toEqual(TEMPLATE);
  });

  it("getFresh returns null when file exists but is stale", async () => {
    const store = new DiskStore(tmpDir, 1_000, 50);
    await store.set(ID, TEMPLATE);
    vi.advanceTimersByTime(2_000);
    expect(await store.getFresh(ID)).toBeNull();
  });

  it("getFallback returns stale entry", async () => {
    const store = new DiskStore(tmpDir, 1_000, 50);
    await store.set(ID, TEMPLATE);
    vi.advanceTimersByTime(2_000);
    expect(await store.getFallback(ID)).toEqual(TEMPLATE);
  });

  it("getFallback returns null when file does not exist", async () => {
    const store = new DiskStore(tmpDir, 300_000, 50);
    expect(await store.getFallback(ID)).toBeNull();
  });

  it("getFallback returns null when file is corrupted", async () => {
    const store = new DiskStore(tmpDir, 300_000, 50);
    // Write a corrupted file directly
    await writeFile(join(tmpDir, `${ID}.json`), "not-valid-json", "utf8");
    expect(await store.getFallback(ID)).toBeNull();
  });

  // ── Writes ─────────────────────────────────────────────────────────────────

  it("set creates the cache directory if it does not exist", async () => {
    const nestedDir = join(tmpDir, "a", "b", "c");
    const store = new DiskStore(nestedDir, 300_000, 50);
    await store.set(ID, TEMPLATE);
    expect(await store.getFresh(ID)).toEqual(TEMPLATE);
  });

  it("set writes minified JSON (no indentation)", async () => {
    const store = new DiskStore(tmpDir, 300_000, 50);
    await store.set(ID, TEMPLATE);
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(join(tmpDir, `${ID}.json`), "utf8");
    // Minified JSON has no newlines in the middle
    expect(raw.split("\n")).toHaveLength(1);
  });

  it("set overwrites an existing entry", async () => {
    const store = new DiskStore(tmpDir, 300_000, 50);
    await store.set(ID, TEMPLATE);
    const updated = { ...TEMPLATE, template_name: "Updated" };
    await store.set(ID, updated);
    expect(await store.getFresh(ID)).toEqual(updated);
  });

  // ── Invalidate ─────────────────────────────────────────────────────────────

  it("invalidate removes the file", async () => {
    const store = new DiskStore(tmpDir, 300_000, 50);
    await store.set(ID, TEMPLATE);
    await store.invalidate(ID);
    expect(await store.getFresh(ID)).toBeNull();
  });

  it("invalidate on a missing file is a no-op", async () => {
    const store = new DiskStore(tmpDir, 300_000, 50);
    await expect(store.invalidate("does-not-exist")).resolves.toBeUndefined();
  });

  // ── Clear ──────────────────────────────────────────────────────────────────

  it("clear removes all JSON files from the cache directory", async () => {
    const store = new DiskStore(tmpDir, 300_000, 50);
    await store.set("id-1", TEMPLATE);
    await store.set("id-2", TEMPLATE);
    await store.clear();
    expect(await store.list()).toHaveLength(0);
  });

  it("clear on a non-existent directory is a no-op", async () => {
    const store = new DiskStore(join(tmpDir, "does-not-exist"), 300_000, 50);
    await expect(store.clear()).resolves.toBeUndefined();
  });

  // ── List ───────────────────────────────────────────────────────────────────

  it("list returns empty array when directory does not exist", async () => {
    const store = new DiskStore(join(tmpDir, "does-not-exist"), 300_000, 50);
    expect(await store.list()).toEqual([]);
  });

  it("list returns empty array when directory is empty", async () => {
    const store = new DiskStore(tmpDir, 300_000, 50);
    expect(await store.list()).toEqual([]);
  });

  it("list returns IDs of all cached templates", async () => {
    const store = new DiskStore(tmpDir, 300_000, 50);
    await store.set("id-1", TEMPLATE);
    await store.set("id-2", TEMPLATE);
    const ids = await store.list();
    expect(ids).toContain("id-1");
    expect(ids).toContain("id-2");
    expect(ids).toHaveLength(2);
  });

  it("list excludes .tmp files", async () => {
    const store = new DiskStore(tmpDir, 300_000, 50);
    // Write a stray .tmp file directly
    await writeFile(join(tmpDir, "some-id.json.tmp"), "{}", "utf8");
    expect(await store.list()).toHaveLength(0);
  });

  // ── Eviction ───────────────────────────────────────────────────────────────

  it("evicts oldest file when maxEntries is reached", async () => {
    vi.useRealTimers(); // need real time for fetchedAt ordering
    const store = new DiskStore(tmpDir, 300_000, 2);

    await store.set("id-1", TEMPLATE);
    // Small delay so fetchedAt differs
    await new Promise((r) => setTimeout(r, 10));
    await store.set("id-2", TEMPLATE);
    await new Promise((r) => setTimeout(r, 10));

    // Adding id-3 should evict id-1 (oldest)
    await store.set("id-3", TEMPLATE);

    const ids = await store.list();
    expect(ids).not.toContain("id-1");
    expect(ids).toContain("id-2");
    expect(ids).toContain("id-3");
  });

  it("handles corrupted file during eviction scan without throwing", async () => {
    vi.useRealTimers();
    const store = new DiskStore(tmpDir, 300_000, 2);

    // Write a corrupted file that looks like a cache file
    await writeFile(join(tmpDir, "corrupted.json"), "not-json", "utf8");
    await new Promise((r) => setTimeout(r, 10));
    await store.set("id-2", TEMPLATE);
    await new Promise((r) => setTimeout(r, 10));

    // Adding id-3 should evict the corrupted file (fetchedAt: 0 → oldest)
    await expect(store.set("id-3", TEMPLATE)).resolves.toBeUndefined();
    const ids = await store.list();
    expect(ids).toContain("id-2");
    expect(ids).toContain("id-3");
  });

  // ── ID sanitisation ────────────────────────────────────────────────────────

  it("sanitises non-UUID characters in template ID", async () => {
    const store = new DiskStore(tmpDir, 300_000, 50);
    // An ID with a path separator — should NOT escape the cache dir
    const weirdId = "normal-id/../../../etc/passwd";
    await store.set(weirdId, TEMPLATE);
    // The sanitised file should be inside tmpDir, not escaped
    const ids = await store.list();
    expect(ids).toHaveLength(1);
    // The file must be inside the cache directory
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(tmpDir);
    expect(files.every((f) => !f.includes("/"))).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// TemplateCache facade
// ══════════════════════════════════════════════════════════════════════════════

describe("TemplateCache (facade)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("delegates getFresh to the underlying store", async () => {
    const store = new MemoryStore(300_000, 50);
    const cache = new TemplateCache(store);
    store.set(ID, TEMPLATE);
    expect(await cache.getFresh(ID)).toEqual(TEMPLATE);
  });

  it("delegates getFallback to the underlying store", async () => {
    const store = new MemoryStore(1_000, 50);
    const cache = new TemplateCache(store);
    store.set(ID, TEMPLATE);
    vi.advanceTimersByTime(2_000);
    expect(await cache.getFallback(ID)).toEqual(TEMPLATE);
  });

  it("delegates set to the underlying store", async () => {
    const store = new MemoryStore(300_000, 50);
    const cache = new TemplateCache(store);
    await cache.set(ID, TEMPLATE);
    expect(store.getFresh(ID)).toEqual(TEMPLATE);
  });

  it("delegates invalidate to the underlying store", async () => {
    const store = new MemoryStore(300_000, 50);
    const cache = new TemplateCache(store);
    store.set(ID, TEMPLATE);
    await cache.invalidate(ID);
    expect(store.getFresh(ID)).toBeNull();
  });

  it("delegates clear to the underlying store", async () => {
    const store = new MemoryStore(300_000, 50);
    const cache = new TemplateCache(store);
    store.set(ID, TEMPLATE);
    await cache.clear();
    expect(store.list()).toHaveLength(0);
  });

  it("delegates list to the underlying store", async () => {
    const store = new MemoryStore(300_000, 50);
    const cache = new TemplateCache(store);
    store.set(ID, TEMPLATE);
    expect(await cache.list()).toContain(ID);
  });
});
