// src/cache.ts
import { mkdir, writeFile, readFile, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { TemplateJson } from "./types.js";

// ── Shared types ──────────────────────────────────────────────────────────────

interface CacheEntry {
  template: TemplateJson;
  fetchedAt: number;
  ttl: number;
}

/** Serialised form written to disk (superset of CacheEntry). */
interface DiskEntry extends CacheEntry {
  templateId: string;
}

// ── Strategy interface ────────────────────────────────────────────────────────

/**
 * All cache implementations must satisfy this interface.
 * TemplateCache delegates every operation to the active store so the rest of
 * the SDK is unaware of which strategy is in use.
 */
export interface CacheStore {
  getFresh(id: string): TemplateJson | null | Promise<TemplateJson | null>;
  getFallback(id: string): TemplateJson | null | Promise<TemplateJson | null>;
  set(id: string, template: TemplateJson): void | Promise<void>;
  invalidate(id: string): void | Promise<void>;
  clear(): void | Promise<void>;
  list(): string[] | Promise<string[]>;
}

// ── Memory store ──────────────────────────────────────────────────────────────

/**
 * In-process LRU-ish memory cache with TTL + stale-on-error fallback.
 *
 * TTL expiry      — after `ttl` ms a fresh fetch is attempted.
 * Stale fallback  — if the fresh fetch fails the stale entry is returned so
 *                   renders keep working even when the Maildeno server is down.
 * Eviction        — when `maxEntries` is reached the oldest entry is dropped.
 */
export class MemoryStore implements CacheStore {
  private readonly store = new Map<string, CacheEntry>();
  private readonly ttl: number;
  private readonly maxEntries: number;

  constructor(ttl: number, maxEntries: number) {
    this.ttl = ttl;
    this.maxEntries = maxEntries;
  }

  getFresh(id: string): TemplateJson | null {
    const entry = this.store.get(id);
    if (!entry) return null;
    if (this._isStale(entry)) return null;
    return entry.template;
  }

  getFallback(id: string): TemplateJson | null {
    return this.store.get(id)?.template ?? null;
  }

  set(id: string, template: TemplateJson): void {
    // Evict oldest when full (only when adding a new key, not updating)
    if (this.store.size >= this.maxEntries && !this.store.has(id)) {
      const oldest = [...this.store.entries()].sort(
        (a, b) => a[1].fetchedAt - b[1].fetchedAt,
      )[0]?.[0];
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(id, { template, fetchedAt: Date.now(), ttl: this.ttl });
  }

  invalidate(id: string): void {
    this.store.delete(id);
  }

  clear(): void {
    this.store.clear();
  }

  list(): string[] {
    return [...this.store.keys()];
  }

  private _isStale(entry: CacheEntry): boolean {
    return Date.now() - entry.fetchedAt > entry.ttl;
  }
}

// ── Disk store ────────────────────────────────────────────────────────────────

/**
 * Persistent disk-based cache.
 *
 * Storage layout — one file per template:
 *
 *   {cacheDir}/
 *     a7f4b181-a366-4944-a371-e7b941a3c5ab.json
 *     9ec0c043-e8a1-4a68-bbb3-92fbef1ea222.json
 *     550e8400-e29b-41d4-a716-446655440000.json
 *
 * The filename is the template UUID as-is. UUIDs contain only
 * [0-9a-f-] which is safe on every modern filesystem (ext4, NTFS, HFS+,
 * APFS). Any other character in the ID is replaced with `_` as a
 * defensive measure — this never fires for real Maildeno template IDs.
 *
 * File contents:
 * {
 *   "templateId": "a7f4b181-...",
 *   "fetchedAt":  1717776000000,
 *   "ttl":        300000,
 *   "template":   { ...TemplateJson... }
 * }
 *
 * Freshness is evaluated identically to MemoryStore:
 *   stale when Date.now() - fetchedAt > ttl
 *
 * The cache directory is created automatically on the first write.
 * The user is responsible for pointing `path` at a location their
 * process has write permission to.
 */
export class DiskStore implements CacheStore {
  private readonly cacheDir: string;
  private readonly ttl: number;
  private readonly maxEntries: number;

  constructor(cacheDir: string, ttl: number, maxEntries: number) {
    this.cacheDir = cacheDir;
    this.ttl = ttl;
    this.maxEntries = maxEntries;
  }

  // ── Reads ──────────────────────────────────────────────────────────────────

  async getFresh(id: string): Promise<TemplateJson | null> {
    const entry = await this._read(id);
    if (!entry) return null;
    if (this._isStale(entry)) return null;
    return entry.template;
  }

  async getFallback(id: string): Promise<TemplateJson | null> {
    const entry = await this._read(id);
    return entry?.template ?? null;
  }

  // ── Writes ─────────────────────────────────────────────────────────────────

  async set(id: string, template: TemplateJson): Promise<void> {
    // Ensure directory exists before enforcing limit or writing
    await mkdir(this.cacheDir, { recursive: true });
    await this._enforceLimit();

    const entry: DiskEntry = {
      templateId: id,
      template,
      fetchedAt: Date.now(),
      ttl: this.ttl,
    };

    // Write atomically: write to a temp file then rename so a crash
    // mid-write never leaves a corrupted cache file.
    const finalPath = this._path(id);
    const tmpPath = `${finalPath}.tmp`;
    await writeFile(tmpPath, JSON.stringify(entry, null, 2), "utf8");

    const { rename } = await import("node:fs/promises");
    await rename(tmpPath, finalPath);
  }

  async invalidate(id: string): Promise<void> {
    try {
      await unlink(this._path(id));
    } catch {
      // File absent — nothing to do
    }
  }

  async clear(): Promise<void> {
    let files: string[];
    try {
      files = await readdir(this.cacheDir);
    } catch {
      return; // Directory doesn't exist yet — nothing to clear
    }
    await Promise.all(
      files
        .filter((f) => f.endsWith(".json") && !f.endsWith(".tmp"))
        .map((f) => unlink(join(this.cacheDir, f)).catch(() => {})),
    );
  }

  async list(): Promise<string[]> {
    let files: string[];
    try {
      files = await readdir(this.cacheDir);
    } catch {
      return [];
    }
    return files
      .filter((f) => f.endsWith(".json") && !f.endsWith(".tmp"))
      .map((f) => f.slice(0, -5)); // strip ".json" → bare UUID
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  /**
   * Build the full path for a template file.
   *
   * Template IDs are UUIDs — [0-9a-f-] — so they pass through the
   * sanitiser unchanged. The replace is a defensive guard only.
   *
   *   "a7f4b181-a366-4944-a371-e7b941a3c5ab"
   *   → "{cacheDir}/a7f4b181-a366-4944-a371-e7b941a3c5ab.json"
   */
  private _path(id: string): string {
    const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "_");
    return join(this.cacheDir, `${safeId}.json`);
  }

  private async _read(id: string): Promise<DiskEntry | null> {
    try {
      const raw = await readFile(this._path(id), "utf8");
      return JSON.parse(raw) as DiskEntry;
    } catch {
      return null; // File absent or corrupted — treat as cache miss
    }
  }

  private _isStale(entry: CacheEntry): boolean {
    return Date.now() - entry.fetchedAt > entry.ttl;
  }

  /**
   * Ensure the number of cached files stays within maxEntries.
   * Reads only the `fetchedAt` field from each file (not the full template)
   * to keep the eviction scan cheap even with large template payloads.
   */
  private async _enforceLimit(): Promise<void> {
    let files: string[];
    try {
      files = (await readdir(this.cacheDir)).filter(
        (f) => f.endsWith(".json") && !f.endsWith(".tmp"),
      );
    } catch {
      return; // Directory empty or missing — nothing to evict
    }

    if (files.length < this.maxEntries) return;

    // Read fetchedAt from each file header — parse only what we need
    const entries: Array<{ file: string; fetchedAt: number }> =
      await Promise.all(
        files.map(async (file) => {
          try {
            const raw = await readFile(join(this.cacheDir, file), "utf8");
            const parsed = JSON.parse(raw) as Partial<DiskEntry>;
            return { file, fetchedAt: parsed.fetchedAt ?? 0 };
          } catch {
            return { file, fetchedAt: 0 }; // Corrupted file — evict first
          }
        }),
      );

    entries.sort((a, b) => a.fetchedAt - b.fetchedAt);

    // Evict enough oldest entries to make room for the new one
    const toEvict = entries.slice(0, entries.length - this.maxEntries + 1);
    await Promise.all(
      toEvict.map(({ file }) =>
        unlink(join(this.cacheDir, file)).catch(() => {}),
      ),
    );
  }
}

// ── TemplateCache facade ──────────────────────────────────────────────────────

/**
 * Thin async facade over the active CacheStore.
 *
 * client.ts uses this exclusively — it never references MemoryStore or
 * DiskStore directly, so swapping the underlying store is transparent.
 */
export class TemplateCache {
  private readonly store: CacheStore;

  constructor(store: CacheStore) {
    this.store = store;
  }

  async getFresh(id: string): Promise<TemplateJson | null> {
    return this.store.getFresh(id);
  }

  async getFallback(id: string): Promise<TemplateJson | null> {
    return this.store.getFallback(id);
  }

  async set(id: string, template: TemplateJson): Promise<void> {
    await this.store.set(id, template);
  }

  async invalidate(id: string): Promise<void> {
    await this.store.invalidate(id);
  }

  async clear(): Promise<void> {
    await this.store.clear();
  }

  /** Return the IDs of all templates currently held in the cache. */
  async list(): Promise<string[]> {
    return this.store.list();
  }
}
