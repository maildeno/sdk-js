# Changelog

All notable changes to this project will be documented in this file.
This project adheres to [Semantic Versioning](https://semver.org/).

---

## [2.1.3] - 2026-07-10

### Changed

- **Updated the embedded WebAssembly rendering engine.** The SDK now ships with
  the latest `engine.wasm`, incorporating rendering improvements and internal
  engine refinements while maintaining API compatibility.

### Internal

- **Aligned the SDK with the unified Maildeno rendering engine build system.**
  The rendering engine is now produced from the same cross-platform build
  pipeline used across Maildeno SDKs, ensuring consistent rendering behaviour
  between WebAssembly and native runtimes.

## [2.1.2] - 2026-06-21

### Fixed

- **Menu component spacing corrected for mobile screens.** Left, right, and
  bottom margins were misaligned on small viewports. Margins are now consistent
  across breakpoints.

- **Preheader spacer sequence added for HTML and MJML templates.** Preheader
  text lacked the invisible-character padding sequence needed to prevent email
  clients from pulling in unwanted body text as preview copy. The standard
  spacer string (`&#847; &zwnj; &nbsp;` × 7) is now included after the
  preheader content in both plain HTML and MJML output.

## [2.1.1] - 2026-06-12

### Fixed

- **Visibility context now handles non-string values.** Context passed as a
  number or boolean (e.g. `context: { premium: true }`, `context: { tier: 2 }`)
  was read as empty, so visibility rules comparing against it never matched and
  the affected rows/columns were always hidden. Numbers and booleans are now
  coerced for comparison (`2` matches `"2"`, `true` matches `"true"`). String
  context values were unaffected and continue to work.

- **Visibility context keys are now matched case-insensitively.** The rule tag
  was lowercased before lookup while the context key was matched exactly, so
  camelCase or capitalized keys (e.g. `orderCount`, `Premium`) never resolved.
  Keys now match regardless of case. Note that the rule's `tag` must still
  match the context key *name* — `isPremium` and `premium` remain distinct.

## [2.1.0] - 2026-06-07

### Added

- **Disk cache strategy.** Set `cache: { type: "disk", path: "..." }` to
  persist template JSON to the local filesystem. Disk-cached entries survive
  process restarts and are shared across workers in the same filesystem.

- **`cache` config object.** All cache settings are now unified under a single
  `cache` key. `type`, `path`, `ttl`, and `maxEntries` live here.

  ```ts
  // Memory (default — no change required for existing code)
  new MaildenoClient({ apiKey: "...", cache: { ttl: 300_000 } })

  // Disk
  new MaildenoClient({
    apiKey: "...",
    cache: { type: "disk", path: "/var/cache/maildeno", ttl: 300_000 },
  })
  ```

- **`client.listCached()`** — returns the IDs of all templates currently in
  the cache (memory or disk). Useful for inspection, monitoring, and
  building admin dashboards.

  ```ts
  const ids = await client.listCached()
  // ["550e8400-...", "9ec0c043-..."]
  ```

- **`client.deleteCached(templateId)`** — removes a single template from the
  cache. Replaces the old `invalidate()` method with a clearer name. Use this
  in webhook handlers to propagate template updates immediately.

- **`CacheConfig` type** exported from package root.

### Changed

- `client.clearCache()` is now async (was sync). Awaiting it is required in
  disk mode; memory mode resolves immediately so existing code that does not
  `await` will still work in practice, but adding `await` is recommended.

- `client.invalidate(templateId)` is now async and marked `@deprecated`.
  It delegates to `deleteCached()` internally — existing code continues to
  work without changes.

### Removed — breaking

- **`cacheTtl` top-level config option** — moved into `cache.ttl`.
- **`cacheMaxEntries` top-level config option** — moved into `cache.maxEntries`.

### Migration from v2.0

```diff
  const client = new MaildenoClient({
    apiKey: "sk_live_...",
-   cacheTtl:        300_000,
-   cacheMaxEntries: 50,
+   cache: { ttl: 300_000, maxEntries: 50 },
  })

- client.invalidate("template-id")
+ await client.deleteCached("template-id")
```

---

## [2.0.0] - 2026-06-05

### Changed — breaking

- **Rendering is now local.** The SDK no longer sends `dynamic_data` to the
  Maildeno server. Template JSON is fetched once via `GET /v1/sdk/template/{id}`
  and rendered in-process using the embedded engine. Your merge tags and
  visibility context never leave your server.
- `RenderResult` now includes an optional `fromStaleCache?: boolean` field.
  Code that destructures `{ templateId, target, output }` is unaffected.
- `POST /v1/sdk/render` is deprecated. The SDK no longer calls it. Existing
  direct HTTP integrations continue to work until the endpoint is removed
  (see sunset date in the `Deprecation` response header).

### Added

- **In-process template cache.** Template JSON is cached after the first fetch.
  Subsequent calls to the same `templateId` render with zero network overhead.
- **Stale-on-error fallback.** If the cache TTL expires and the server cannot
  be reached, the SDK renders from the last known-good cached copy and sets
  `result.fromStaleCache = true`.
- **`cacheTtl` config option.** *(deprecated in v2.1 — use `cache.ttl`)*
- **`cacheMaxEntries` config option.** *(deprecated in v2.1 — use `cache.maxEntries`)*
- **`client.invalidate(templateId)`** *(deprecated in v2.1 — use `deleteCached()`)*
- **`client.clearCache()`**
- **Output minification.**
- **`TemplateJson` type** exported from package root.

### Migration from v1

```diff
- // v1 — server rendered
+ // v2 — local render, same API surface
  const result = await client.render({
    templateId: "...",
    target: "html",
    dynamicData: { merge_tags: { text: { name: "Noruwa" } } },
  })
```

---

## [1.0.0] - 2026-05-29

### Added

- Initial public release
- `MaildenoClient` with `render()`, `renderHtml()`, `renderReact()`, `renderMjml()`
- Full TypeScript types exported from package root
- Structured `MaildenoError` with `code`, `status`, and `issues`
- Dual CJS/ESM build via `tsup`
- Vitest test suite with full error-path coverage