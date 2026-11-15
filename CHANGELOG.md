# Changelog

All notable changes to this project will be documented in this file.
This project adheres to [Semantic Versioning](https://semver.org/).

---

## [2.3.1] - 2026-11-15

### Fixed

- **A font set on part of a text is now requested correctly.** The editor writes such a font into the content of a paragraph, heading or list as `<span style="font-family: &quot;Open Sans&quot;;">`. The engine took the `;` of `&quot;` for the end of the declaration and read the family as `&quot`, so the real font was never requested, and the Google Fonts link of every export carried an entry that is not a font: an empty `family=` and a stray `&quot:wght@400;500;600;700`. Open Sans, Roboto, Lora and every other font chosen for a selection were missing from the link, in HTML, MJML and React Email.
  `extract_font_families_from_html` now:
  - decodes `&quot;`, `&#39;` and `&apos;` before it reads, and reads a name as the editor's `extractFontFamiliesFromHtml` does;
  - reads `style='font-family: "Open Sans"'`;
  - ends a bare name at `!important`;
  - requires the colon, so the words "font-family" in a text are not taken for a declaration;
  - finds the property without lower-casing the text, which previously put the position in the wrong place, and could panic, when a capital letter is longer in lower case (`İ`).
- **React Email keeps the quotes a font name needs.** A name with a word that starts with a digit (`Exo 2`, `Source Sans 3`, `Source Serif 4`) is not valid CSS without quotes, and the browser drops the whole declaration. React Email took the quotes off every name, so `fontFamily: "Exo 2, Arial, sans-serif"` never applied. It is now `"'Exo 2', Arial, sans-serif"`, as the editor writes it, for the font of a block and for a font set inside the text. HTML and MJML always quoted the name.
- **Removed an unnecessary 2px border hack** on the mobile override for table cells.

The only output that changes is the Google Fonts link (the entry that was not a font goes, the missing families come in) and, in React Email, the font-family of a block or span whose font has a digit in its name.

## [2.3.0] - 2026-11-14

### Added

**Rows, columns, images and buttons have a Shadow control.** Select one and open its panel: the new **Shadow** section, above Spacing, has a **Box shadow** switch, presets (Soft, Medium, Strong, Hard and Inner, which an image does not get), sliders for Offset X, Offset Y, Blur and Spread, a colour with opacity, and an Inset switch. A small preview box shows the shadow as you change it. Switching it off keeps the values, so switching it back on gives the shadow you had.

A shadow can be different on mobile. In the Mobile tab the control starts from the desktop shadow; change it and the section shows the overridden badge and a Reset link, as other settings do. A mobile shadow replaces the desktop one as a whole, so switching it off on mobile removes the shadow on small screens and leaves the desktop one alone. A mobile shadow that draws the same thing as the desktop one is not kept as an override.

The shadow shows on the canvas and in Preview, and is exported to HTML, MJML and React Email: on the row's `<td>` (or `<Section>`), the column's `<td>`, the `<img>` and the button's link. An image draws its shadow outside its box, so Inset is not offered there. Email clients that ignore `box-shadow` show the block without it. Classic Outlook for Windows, Gmail (on the web, and in its apps for Google accounts), Yahoo and AOL are the main ones.

`BoxShadow` is a new exported type, `{ enabled, offsetX, offsetY, blur, spread, color, inset }`. Rows and columns save it as `boxShadow` on the node and under `mobile`; images and buttons keep it in `props.boxShadow` and `props.mobile.boxShadow`. A block with no shadow saves without the key, so a template that does not use shadows saves exactly as before; one with the shadow switched off but changed from the defaults keeps its values. `schema_version` stays `"1.0"` and there is nothing to migrate. Values are clamped on the way in (offsets and spread to -50 to 50, blur to 0 to 100) and the colour is checked, so a hand-edited template cannot put anything but a colour into the email's inline style.

### Changed

**Rows and columns stop clipping when a shadow inside them needs the room.** Rows and columns cut off anything that sticks out of them (`overflow: hidden`), which is what keeps a background inside a rounded corner. It also cuts off a shadow inside them: the glow of an image, a button, a column or a nested row, for a row a column's shadow included. A row or column now clips only when it has to: when nothing inside it has a shadow, as before, or when it is rounded and its content can reach a corner, meaning the padding on both sides of that corner is too small to keep the content inside the curve. A square row or column, and a rounded one with enough padding, lets the shadow draw in full. A rounded one with no padding keeps clipping, so its backgrounds stay inside the corners and a shadow inside it is cut off at its edge. To keep that shadow, give the row or column some padding, or put the shadow on the row or column itself, which its own clip never cuts. The rule looks at the desktop and the mobile radius, border and padding together, because the clip is a single declaration, and it is the one rule used by the canvas, the Source pane and the HTML, MJML and React Email export, including the extra element a row gets to carry a border or a mobile border. A template with no shadows exports exactly as it did before.

A row with a column shadow is laid out with `border-collapse: separate`, as it already was for a gap or a rounded column, so the shadow draws the same in every browser engine. A later column is drawn over an earlier column's shadow where they touch, as in any table; add a gap to the row or some padding to keep it clear.

**A row's own shadow is drawn in the HTML and MJML exports.** The row's `<td>` carried both the row's shadow and its clip, and a table cell that clips is drawn without its own shadow when the table's borders are collapsed, which is how the email's tables are laid out (seen in Chrome). So the row's glow went missing in the exported HTML and MJML, and in the Preview panes that show the exported HTML, apart from the bits outside the rounded corners, while the canvas and the Source pane showed it. The clip now sits on a `<div>` inside the cell, the one that draws the row's border when it has one and otherwise the one that holds its padding, so the shadow stays on the cell and the corners still trim whatever the row holds. It applies the same way to a row whose shadow is set for mobile only. A row without a shadow of its own exports exactly as it did before, and React Email, where a row is a `<Section>` table, was not affected.

**Preview now matches caniemail for `box-shadow`.** The Gmail (web, Android and iOS), Yahoo and AOL previews remove shadows, because those clients drop `box-shadow` (the Gmail apps keep it only for accounts that are not Google accounts, and the preview shows the usual Google-account case), and the Samsung Email preview keeps them. The capability badge no longer says "Only modern WebKit clients". The preview also removes only the `box-shadow` declaration from the mobile stylesheet, not the text that follows it.

**The Source pane of the Inbox preview shows a row's shadow.** Its paper card clipped everything outside the email's width to round its own corners, which hid a shadow around a full-width row. The card now stops clipping when a row has a shadow, or something inside it does; without shadows it is unchanged.

### Fixed

**The colour picker now opens on `rgba()` colours and restores their opacity.** It could only read hex when it opened: an `rgba(0, 0, 0, 0.15)` colour, the form a colour with opacity is saved in, showed as solid red, and **Revert** left the opacity slider wherever it had been dragged. It now reads hex with or without alpha, and `rgb()` and `rgba()` in either syntax, opens on the right colour and opacity, and Revert puts both back. A swatch in Recent colours is applied exactly as it was saved, opacity included; a solid swatch used to take on whatever opacity the slider was at.

## [2.2.2] - 2026-11-12

### Fixed

Removed an unnecessary 2px border hack on table cells. The <td> border carried an extra 2px that was no longer needed. With the hack gone, the border no longer clips past the corners.

## [2.2.1] - 2026-11-11

### Fixed

**Long words no longer overflow the email body.** A long unbroken token — a URL, a tracking ID, a hash — ran past the edge of the body in all three exports and made the message scroll sideways on narrow screens. The body now breaks long words, in HTML, MJML and React Email alike.

Each output needed its own fix. In HTML the rule goes on the body element. In MJML it goes in an `<mj-style>` block, because `mj-body` drops an inline `style` attribute. In React Email it goes on the container's style object as `wordBreak: "break-all"`.

`word-break: break-all` breaks wherever a line runs out of room, so a long word is split mid-word rather than pushed past the edge. The catch is that it applies to every word, not only the ones that would overflow: a normal word at the end of a full line may now be split too. Outlook desktop ignores the property, so there a long token can still overflow — nothing changes for that client.

## [2.2.0] - 2026-11-01

### Added
* **Mobile property overrides for Row, Column, and Row Spacer components.** Added support for rendering the editor's sparse `mobile` configuration in HTML, MJML, and React Email, ensuring mobile-specific styles are applied instead of falling back to desktop values.
  * **Row:** `backgroundColor`, `backgroundGradient`, `padding`, `border`, `minHeight`, `gap`.
  * **Column:** `backgroundColor`, `backgroundGradient`, `padding`, `border`, `verticalAlign`.
  * **Row Spacer:** `height`, `backgroundColor`, `backgroundGradient`.
  * Nodes with at least one non-null mobile property receive the required hook classes (`eb-<id>`, `eb-<id>-box`, `eb-<id>-outer`, `eb-<rowId>-gap`) for targeting mobile overrides.
  * Mobile override rules are generated inside the `/* Mobile property overrides */` block, before component rules, preserving the order in which properties are written by the editor.
  * Nodes without mobile overrides, or with IDs containing characters outside letters, digits, hyphens, and underscores, do not receive mobile hook classes or override rules.
  * **HTML:** Rows with mobile border overrides now receive an outer wrapper even when the desktop border has no radius, ensuring the mobile border has an element to target.
  * Hidden rows, columns, and row spacers, as well as row spacers with a height of `0`, are excluded from mobile override generation.

##  [2.1.7] - 2026-09-20

### Fixed
* **Button and Anchor components – padding is now applied to the clickable link element.** Moved padding from the container <div> to the <a> / <Link> element across the HTML, MJML, and React Email renderers. Generated styles now target the .{uid}-link selector for Button and Anchor padding.

## [2.1.6] - 2026-08-21

### Fixed

* **Menu and socials components – mobile padding override now properly applied.** The override logic was not being triggered on mobile breakpoints, causing custom padding values to be dropped. This has been corrected, ensuring the specified padding is consistently respected across all screen sizes for both menu and socials blocks.

## [2.1.5] - 2026-08-02

### Fixed

* **Resolved component overflow escaping parent containers.** Parent `<td>` and `<table>` elements now apply `overflow: hidden` where appropriate, ensuring child components correctly respect border radius and remain clipped within their containers across rendered email output.

## [2.1.4] - 2026-07-13

### Fixed

- **Resolved missing border radius on the outer MJML table row.** The outer `<td>` wrapper now correctly preserves border radius during MJML rendering, ensuring consistent rounded corners in the rendered email output.

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