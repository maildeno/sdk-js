// src/cache.ts
import type { TemplateJson } from "./types.js";

interface CacheEntry {
  template: TemplateJson;
  fetchedAt: number;
  ttl: number;
}

/**
 * In-process LRU-ish template cache with two distinct expiry concepts:
 *
 * 1. TTL expiry   — entry is "stale" after `ttl` ms; a fresh fetch is attempted.
 * 2. Fallback     — if the fresh fetch fails (server unreachable, 5xx, timeout),
 *                   the stale entry is returned anyway so renders keep working
 *                   even when Maildeno is down.
 *
 * The fallback has NO expiry — a cached template is used indefinitely until
 * the server comes back and a live fetch succeeds.
 */
export class TemplateCache {
  private readonly store = new Map<string, CacheEntry>();
  private readonly ttl: number;
  private readonly maxEntries: number;

  constructor(ttl = 300_000, maxEntries = 50) {
    this.ttl = ttl;
    this.maxEntries = maxEntries;
  }

  /**
   * Returns the cached template if it exists and is still fresh (within TTL).
   * Returns null on a miss OR when the entry is stale — callers should
   * attempt a fresh fetch, then call `getFallback` if the fetch fails.
   */
  getFresh(id: string): TemplateJson | null {
    const entry = this.store.get(id);
    if (!entry) return null;
    if (this.isStale(entry)) return null;
    return entry.template;
  }

  /**
   * Returns ANY cached template for the given id regardless of staleness.
   * Used as a fallback when the server cannot be reached.
   * Returns null only if the template has never been fetched successfully.
   */
  getFallback(id: string): TemplateJson | null {
    return this.store.get(id)?.template ?? null;
  }

  /** Store a freshly-fetched template, evicting the oldest entry if full. */
  set(id: string, template: TemplateJson): void {
    if (this.store.size >= this.maxEntries && !this.store.has(id)) {
      const oldest = [...this.store.entries()].sort(
        (a, b) => a[1].fetchedAt - b[1].fetchedAt,
      )[0]![0];
      this.store.delete(oldest);
    }
    this.store.set(id, {
      template,
      fetchedAt: Date.now(),
      ttl: this.ttl,
    });
  }

  /** Force-remove a specific template (call after receiving a webhook). */
  invalidate(id: string): void {
    this.store.delete(id);
  }

  /** Wipe the entire cache. */
  clear(): void {
    this.store.clear();
  }

  /** True if the entry exists in cache at all (fresh or stale). */
  has(id: string): boolean {
    return this.store.has(id);
  }

  private isStale(entry: CacheEntry): boolean {
    return Date.now() - entry.fetchedAt > entry.ttl;
  }
}
