# maildeno

Official JavaScript / TypeScript SDK for the **Maildeno** template API.

## Installation

```bash
npm install maildeno
```

---

## Quick start

```ts
import { MaildenoClient } from "maildeno"

const client = new MaildenoClient({
  apiKey: "sk_live_4a7f2c8d...",
})

const html = await client.renderHtml("550e8400-e29b-41d4-a716-446655440000")
console.log(html) // rendered HTML string
```

---

## How it works

The SDK fetches your template JSON from the Maildeno API and renders it
**locally** using an embedded engine. Dynamic data (merge tags, visibility
context) never leaves your server.

```
client.render()
  └── GET /v1/sdk/template/{id}   ← one fetch, then cached
        └── render locally         ← merge tags + visibility rules applied
              └── minify output    ← compact for transport / delivery
```

Template JSON is cached in-process (or on disk — see Cache strategies below).
Repeat calls to the same template ID render with **zero network overhead**.
If the cache is stale and the server is unreachable, the stale copy is used
as a fallback — `result.fromStaleCache` will be `true` in that case.

---

## Configuration

```ts
const client = new MaildenoClient({
  // Required — obtain from Dashboard → API Keys → Create Key
  apiKey: "sk_live_...",

  // Optional — request timeout in ms (default: 30_000)
  timeout: 10_000,

  // Optional — cache configuration (see Cache strategies below)
  cache: {
    type:       "memory",   // "memory" (default) | "disk"
    ttl:        300_000,    // ms before a re-fetch is attempted (default: 300_000 = 5 min)
    maxEntries: 50,         // max templates to hold in cache (default: 50)
    // path: ".maildeno-cache"  ← only used when type: "disk"
  },
})
```

---

## Cache strategies

The SDK supports two cache strategies. Choose based on your deployment needs.

### Memory (default)

Template JSON is held in your process's heap. Fast, zero I/O, and requires
no configuration. Lost when the process restarts.

```ts
const client = new MaildenoClient({
  apiKey: "sk_live_...",
  // memory is the default — omit cache entirely, or be explicit:
  cache: { type: "memory", ttl: 300_000, maxEntries: 50 },
})
```

**Best for:** serverless functions, single-process servers, local development.

### Disk

Template JSON is persisted as individual JSON files on the local filesystem.
Entries survive process restarts and are visible to all workers sharing the
same filesystem.

```ts
const client = new MaildenoClient({
  apiKey: "sk_live_...",
  cache: {
    type:       "disk",
    path:       "/var/cache/maildeno",   // absolute path recommended in production
    ttl:        300_000,
    maxEntries: 100,
  },
})
```

**Path resolution:** absolute paths are used as-is. Relative paths (e.g.
`".maildeno-cache"`) are resolved against `process.cwd()`. The directory is
created automatically on the first write.

**File format:** one file per template — `{path}/{template_id}.json`. Each
file contains the template JSON plus `fetchedAt` and `ttl` metadata so
freshness can be evaluated on read.

**Best for:** long-running servers, multi-worker deployments, environments
where you want renders to survive a process restart without a cold-fetch
penalty.

### TTL guide

| Use case                              | Recommended `ttl`          |
|---------------------------------------|----------------------------|
| Templates edited rarely (weekly)      | `300_000` (5 min, default) |
| Templates edited regularly (daily)    | `60_000` (1 min)           |
| Real-time preview / editor tooling    | `0` (always re-fetch)      |
| High-volume transactional (stability) | `600_000` (10 min)         |

---

## Cache management

The client exposes full control over the cache so you can inspect, manage,
and build admin tooling around it.

### List cached templates

```ts
const ids = await client.listCached()
console.log(ids)
// ["550e8400-e29b-41d4-a716-446655440000", "9ec0c043-e8a1-4a68-bbb3-92fbef1ea222"]
```

Works in both memory and disk mode. In disk mode this reads the cache
directory and returns one ID per file — no file contents are loaded.

### Delete a single template

```ts
await client.deleteCached("550e8400-e29b-41d4-a716-446655440000")
```

The next render for this template will fetch a fresh copy from the server,
regardless of TTL.

The Maildeno server invalidates its own cache immediately when you save or
delete a template in the dashboard — so the server always returns the latest
version. The only stale layer is the SDK cache on your own server, which
you control via `ttl`. Call `deleteCached()` any time you want to bypass
that TTL immediately — for example, if you update a template in the dashboard
and want renders to pick up the change straight away rather than waiting for
expiry.

```ts
// Force the next render to fetch a fresh copy right now
await client.deleteCached("550e8400-e29b-41d4-a716-446655440000")
```

### Clear all cached templates

```ts
await client.clearCache()
```

In memory mode this empties the Map. In disk mode this deletes all `.json`
files inside the cache directory but leaves the directory itself intact.

### Build a cache admin endpoint

```ts
// GET /admin/cache           — list all cached template IDs
// DELETE /admin/cache        — clear all
// DELETE /admin/cache/:id    — remove one template

app.get("/admin/cache", async (_req, res) => {
  res.json({ cached: await client.listCached() })
})

app.delete("/admin/cache", async (_req, res) => {
  await client.clearCache()
  res.json({ cleared: true })
})

app.delete("/admin/cache/:id", async (req, res) => {
  await client.deleteCached(req.params.id)
  res.json({ deleted: req.params.id })
})
```

---

## Rendering

### `render(options)` — full control

```ts
const result = await client.render({
  templateId:  "550e8400-e29b-41d4-a716-446655440000",
  target:      "html",        // "html" | "react-email" | "mjml"  (default: "html")
  dynamicData: { ... },       // optional — see Dynamic data section
})

console.log(result.output)          // rendered string
console.log(result.target)          // "html"
console.log(result.templateId)      // "550e8400-..."
console.log(result.fromStaleCache)  // true if rendered from expired cache (server unreachable)
```

### Convenience methods

```ts
// All return the rendered output string directly
const html  = await client.renderHtml("template-id",  dynamicData?)
const tsx   = await client.renderReact("template-id", dynamicData?)
const mjml  = await client.renderMjml("template-id",  dynamicData?)
```

---

## Dynamic data

All fields are **optional**. Include only what your template actually uses.

```ts
// Nothing — template has no merge tags or visibility rules
await client.renderHtml("template-id")

// Text merge tags only
await client.renderHtml("template-id", {
  merge_tags: {
    text: { name: "Noruwa", company: "Maildeno" },
  },
})

// URL merge tags only
await client.renderHtml("template-id", {
  merge_tags: {
    url: {
      reset_url:    "https://app.example.com/reset",
      banner_image: "https://cdn.example.com/banner.jpg",
    },
  },
})

// HTML attribute merge tags (alt text, aria-labels, etc.)
await client.renderHtml("template-id", {
  merge_tags: {
    attr: { alt_text: "Product banner" },
  },
})

// Context — controls visibility rules (show/hide rows)
await client.renderHtml("template-id", {
  context: {
    plan:    "pro",
    country: "usa",
    age:     25,
  },
})

// Everything together
await client.render({
  templateId: "template-id",
  target:     "mjml",
  dynamicData: {
    merge_tags: {
      text: { name: "Noruwa", company: "Maildeno", reset_name: "Password" },
      url:  { reset_url: "https://app.example.com/reset/abc123" },
      attr: { alt_text: "Cave image" },
    },
    context: {
      country:      "usa",
      country_rank: "2",
      expiry:       "2028",
    },
  },
})
```

### Merge tag types

| Type   | Used for                                  | Escaping applied     |
|--------|-------------------------------------------|----------------------|
| `text` | Paragraph / heading / list / button text  | HTML-escaped         |
| `url`  | `href`, `src`, image URLs                 | URL percent-encoded  |
| `attr` | HTML attributes (alt, aria-label, etc.)   | HTML attribute-safe  |

### Context vs merge_tags

- **`merge_tags`** — replaces `{{ placeholders }}` inside the template content
- **`context`** — evaluated against visibility rules to show or hide rows/sections. Not injected into content.

---

## Stale-on-error fallback

If your cache TTL expires and the Maildeno server cannot be reached (network
error, timeout, 5xx), the SDK **does not throw**. Instead it renders from the
last known-good cached copy and sets `result.fromStaleCache = true`.

```ts
const result = await client.render({ templateId: "...", target: "html" })

if (result.fromStaleCache) {
  logger.warn("Maildeno unreachable — rendered from stale cache", {
    templateId: result.templateId,
  })
}
```

This means a Maildeno outage degrades gracefully instead of breaking your
email send pipeline. The only scenario that throws is when the server is
unreachable **and** no cached copy exists (first-ever fetch for that template).

---

## Error handling

All errors thrown by the SDK are instances of `MaildenoError`.

```ts
import { MaildenoClient, MaildenoError } from "maildeno"

try {
  const html = await client.renderHtml("template-id")
} catch (err) {
  if (err instanceof MaildenoError) {
    switch (err.code) {
      case "INVALID_API_KEY":
        // 401 — key is missing, malformed, revoked, or expired
        break
      case "FORBIDDEN":
        // 403 — key scope violation or plan limit reached
        console.error("Forbidden:", err.message)
        break
      case "TEMPLATE_NOT_FOUND":
        // 404
        break
      case "RENDER_ERROR":
        // 422 — template data is invalid or render failed
        if (err.issues) {
          for (const issue of err.issues) {
            console.error(issue.loc.join("."), issue.msg)
          }
        }
        break
      case "NETWORK_ERROR":
        // fetch() threw — no internet, DNS failure, etc.
        break
      case "TIMEOUT":
        // Request exceeded the configured timeout
        break
    }
  }
}
```

---

## Express example

```ts
import express from "express"
import { MaildenoClient, MaildenoError } from "maildeno"

const app = express()
app.use(express.json())

const maildeno = new MaildenoClient({
  apiKey: process.env.MAILDENO_API_KEY!,
  cache:  { type: "memory", ttl: 300_000 },
})

app.post("/api/send-email", async (req, res) => {
  const { templateId, name, plan } = req.body

  try {
    const result = await maildeno.render({
      templateId,
      target: "html",
      dynamicData: {
        merge_tags: { text: { name } },
        context:    { plan },
      },
    })

    if (result.fromStaleCache) {
      req.log?.warn("Rendered from stale cache", { templateId })
    }

    res.json({ html: result.output })
  } catch (err) {
    if (err instanceof MaildenoError) {
      return res.status(err.status || 500).json({
        error:   err.code,
        message: err.message,
      })
    }
    res.status(500).json({ error: "INTERNAL_ERROR" })
  }
})

app.listen(3300)
```

---

## Next.js (App Router)

```ts
// app/api/email/route.ts
import { MaildenoClient } from "maildeno"

const client = new MaildenoClient({
  apiKey: process.env.MAILDENO_API_KEY!,
  cache:  { ttl: 300_000 },
})

export async function POST(req: Request) {
  const { templateId, name, plan } = await req.json()
  const html = await client.renderHtml(templateId, {
    merge_tags: { text: { name } },
    context:    { plan },
  })
  return Response.json({ html })
}
```

---

## API key scopes

API keys can be scoped to specific targets at creation time:

| Targets value     | Allowed render calls                        |
|-------------------|---------------------------------------------|
| `["all"]`         | `html`, `react-email`, `mjml`               |
| `["html"]`        | `html` only — `react-email` / `mjml` → 403  |
| `["html","mjml"]` | `html` and `mjml` — `react-email` → 403     |

---

## Node.js compatibility

| Version | Notes                                     |
|---------|-------------------------------------------|
| 18+     | `fetch` available globally — no polyfill  |
| 16 / 17 | Install `node-fetch` and assign to `globalThis.fetch` |
| < 16    | Not supported                             |

---

## TypeScript types

```ts
import type {
  RenderTarget,    // "html" | "react-email" | "mjml"
  RenderOptions,   // input to client.render()
  RenderResult,    // output from client.render()
  DynamicData,     // { merge_tags?, context? }
  MergeTagGroup,   // { text?, url?, attr? }
  MaildenoConfig,  // constructor config
  CacheConfig,     // { type?, path?, ttl?, maxEntries? }
  SdkErrorCode,    // union of error code strings
  ValidationIssue, // issue exposed on err.issues
  TemplateJson,    // raw template payload returned by the API
} from "maildeno"
```

---

## License

MIT