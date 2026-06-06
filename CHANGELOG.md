# Changelog

All notable changes to this project will be documented in this file.
This project adheres to [Semantic Versioning](https://semver.org/).

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
  be reached (network error, timeout, 5xx), the SDK renders from the last
  known-good cached copy and sets `result.fromStaleCache = true`. Your email
  pipeline continues uninterrupted during Maildeno downtime.
- **`cacheTtl` config option.** Controls how long cached template JSON is
  considered fresh before a re-fetch is attempted. Default: `300_000` (5 min).
- **`cacheMaxEntries` config option.** Maximum number of templates held in the
  in-process cache. Oldest entry evicted when limit is reached. Default: `50`.
- **`client.invalidate(templateId)`** — immediately evict one template from the
  in-process cache. Use this after your own code saves a template change so
  the next render fetches a fresh copy without waiting for TTL expiry.
- **`client.clearCache()`** — wipe the entire in-process cache.
- **Output minification.** Rendered HTML, MJML, and React-email output is
  automatically compacted (whitespace collapsed, blank lines removed) before
  being returned. CSS inside `<style>` blocks is never corrupted.
- **`TemplateJson` type** exported from package root — the shape of the raw
  template payload returned by the API.

### Migration from v1

```diff
- // v1 — server rendered, dynamic_data sent to Maildeno
- const result = await client.render({
-   templateId: "...",
-   target: "html",
-   dynamicData: { merge_tags: { text: { name: "Noruwa" } } },
- })

+ // v2 — local render, same API surface, same result shape
+ const result = await client.render({
+   templateId: "...",
+   target: "html",
+   dynamicData: { merge_tags: { text: { name: "Noruwa" } } },
+ })
+
+ // Optional: check if rendered from stale cache
+ if (result.fromStaleCache) logger.warn("Stale cache used", { templateId: "..." })
```

No changes required to `renderHtml()`, `renderReact()`, or `renderMjml()`.

---

## [1.0.0] - 2026-05-29

### Added

- Initial public release
- `MaildenoClient` with `render()`, `renderHtml()`, `renderReact()`, `renderMjml()`
- Full TypeScript types exported from package root
- Structured `MaildenoError` with `code`, `status`, and `issues`
- Dual CJS/ESM build via `tsup`
- Vitest test suite with full error-path coverage