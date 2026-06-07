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

Template JSON is cached in-process. Repeat calls to the same template ID
render with **zero network overhead**. If the cache is stale and the server
is unreachable, the stale copy is used as a fallback so rendering continues
uninterrupted — `result.fromStaleCache` will be `true` in that case.

---

## Configuration

```ts
const client = new MaildenoClient({
  // Required — obtain from Dashboard → API Keys → Create Key
  apiKey: "sk_live_...",

  // Optional — request timeout in ms (default: 30_000)
  timeout: 10_000,

  // Optional — how long a cached template is considered fresh (default: 300_000 = 5 min)
  // After this period the SDK re-fetches; if the fetch fails, the stale copy
  // is used as a fallback so rendering never hard-fails due to a server blip.
  cacheTtl: 60_000,

  // Optional — max number of templates held in the in-process cache (default: 50)
  cacheMaxEntries: 100,
})
```

### Cache TTL guide

| Use case                              | Recommended `cacheTtl` |
|---------------------------------------|------------------------|
| Templates edited rarely (weekly)      | `300_000` (5 min, default) |
| Templates edited regularly (daily)    | `60_000` (1 min)       |
| Real-time preview / editor tooling    | `0` (disable cache)    |
| High-volume transactional (stability) | `600_000` (10 min)     |

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
console.log(result.fromStaleCache)  // true if rendered from expired cache (server was unreachable)
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

## Cache management

The SDK uses a two-layer cache. Understanding both layers helps you reason
about how quickly template updates reach your renders.

### Layer 1 — Maildeno server cache (Redis)

When you save or delete a template in the Maildeno dashboard or API,
the server invalidates its Redis cache entry immediately. The next SDK
request for that template always fetches a fresh copy from the database —
no delay, no stale data on the server side.

### Layer 2 — SDK in-process cache

The SDK caches template JSON in your application's memory after the first
fetch. This cache expires based on `cacheTtl` (default: 5 minutes). Until
that TTL expires, renders use the in-process copy without hitting the network
at all — even if the template was updated on the server in the meantime.

```
Template saved in dashboard
  └── Server Redis cache invalidated immediately   ✓ instant
        └── SDK in-process cache still valid       ← up to cacheTtl lag
              └── Next TTL expiry → fresh fetch    ✓ up to date again
```

### Controlling the lag

Lower `cacheTtl` if your templates change frequently and you need updates
to propagate quickly:

```ts
const client = new MaildenoClient({
  apiKey:   "sk_live_...",
  cacheTtl: 60_000,   // 1 minute — updates visible within 1 min
})
```

Manually drop a template from the in-process cache if you need it
immediately — for example after your own template editor saves a change:

```ts
// Force the next render to fetch a fresh copy from the server
client.invalidate("550e8400-e29b-41d4-a716-446655440000")

// Wipe the entire in-process cache
client.clearCache()
```

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
unreachable **and** no prior cached copy exists (first-ever fetch for that
template).

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
        // 403 — two possible causes, check err.message to distinguish:
        //   1. Key scope violation — key was created with targets: ["html"]
        //      but you requested "mjml"
        //   2. Plan limit reached — your account has hit the render limit
        //      for your current billing period
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
        // Note: if a stale cache exists this error is suppressed automatically
        break
      case "TIMEOUT":
        // Request exceeded the configured timeout
        break
    }
  }
}
```

### Error properties

```ts
err.code      // SdkErrorCode — machine-readable
err.message   // Human-readable detail from the API
err.status    // HTTP status code (0 for NETWORK_ERROR / TIMEOUT)
err.issues    // ValidationIssue[] | undefined — populated on 422 validation errors
```

---

## Express example

```ts
import express from "express"
import { MaildenoClient, MaildenoError } from "maildeno"

const app = express()
app.use(express.json())

const maildeno = new MaildenoClient({
  apiKey:   process.env.MAILDENO_API_KEY!,
  cacheTtl: 300_000,
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
  apiKey:   process.env.MAILDENO_API_KEY!,
  cacheTtl: 300_000,
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

```bash
POST https://api.maildeno.com/api/v1/keys
{ "name": "HTML only", "targets": ["html"] }
```

---

## Node.js compatibility

| Version   | Notes                                      |
|-----------|--------------------------------------------|
| 18+       | `fetch` available globally — no polyfill   |
| 16 / 17   | Install `node-fetch` and assign to `globalThis.fetch` |
| < 16      | Not supported                              |

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
  SdkErrorCode,    // union of error code strings
  ValidationIssue, // issue exposed on err.issues
  TemplateJson,    // raw template payload returned by the API
} from "maildeno"
```

---

## License

MIT