# maildeno

Official JavaScript / TypeScript SDK for the **Maildeno** render API.

## Installation

```bash
npm install maildeno
```

---

## Quick start

```ts
import { MaildenoClient } from "maildeno"

const client = new MaildenoClient({
  apiKey:  "sk_live_4a7f2c8d...",
})

const html = await client.renderHtml("550e8400-e29b-41d4-a716-446655440000")
console.log(html) // <!DOCTYPE html>...
```

---

## Configuration

```ts
const client = new MaildenoClient({
  // Required — obtain from Dashboard → API Keys → Create Key
  apiKey: "sk_live_...",

  // Optional — request timeout in ms, defaults to 30000
  timeout: 10_000,
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

console.log(result.output)      // rendered string
console.log(result.target)      // "html"
console.log(result.templateId)  // "550e8400-..."
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
        console.error("Check your API key")
        break
      case "FORBIDDEN":
        // 403 — key does not have scope for the requested target
        // e.g. key was created with targets: ["html"] but you requested "mjml"
        console.error("Key scope:", err.message)
        break
      case "TEMPLATE_NOT_FOUND":
        // 404
        console.error("Template not found")
        break
      case "RENDER_ERROR":
        // 422 — template data is invalid or render failed
        console.error("Render failed:", err.message)
        break
      case "NETWORK_ERROR":
        // fetch() threw — no internet, DNS failure, etc.
        console.error("Network error:", err.message)
        break
      case "TIMEOUT":
        // Request exceeded the configured timeout
        console.error("Request timed out")
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

#### Inspecting validation errors

When the API rejects a request because the input itself is malformed (for example,
a `templateId` that isn't a valid UUID), the SDK surfaces every pydantic issue
on `err.issues`:

```ts
try {
  await client.renderHtml("not-a-uuid")
} catch (err) {
  if (err instanceof MaildenoError && err.issues) {
    for (const issue of err.issues) {
      console.error(issue.loc.join("."), issue.msg)
      // → body.template_id  Input should be a valid UUID, ...
    }
  }
}
```

---


### Frontend usage

The SDK works in browsers (Vite, Next.js client components, CRA, etc.) since `fetch` is native — but **don't ship your API key to the client**. Always proxy through a server endpoint:

```ts
// ❌ Don't do this in browser code
const client = new MaildenoClient({ apiKey: "sk_live_..." })

// ✅ Do this, which uses the SDK server-side
const response = await fetch("https://api.maildeno.com/v1/sdk/render", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer sk_live_your_api_key"
  },
  body: JSON.stringify({
    template_id: "c1a28520-c0ef-41e7-8348-da18fb7769d1",
    target: "html",
    dynamic_data: {
      merge_tags: {
        text: {
          name: "Noruwa",
          company: "Maildeno"
        }
      },
      context: {
        plan: "standard"
      }
    }
  })
})

const html = await response.text()
console.log(html)
```


---

## Express example

```ts
// server.ts
import express from "express"
import { MaildenoClient, MaildenoError } from "maildeno"

const app = express()
app.use(express.json())

const maildeno = new MaildenoClient({
  apiKey:  process.env.MAILDENO_API_KEY!,
})

app.post("/api/render-email", async (req, res) => {
  const { templateId, name, plan } = req.body

  try {
    const html = await maildeno.renderHtml(templateId, {
      merge_tags: { text: { name: name } },
      context:    { plan },
    })
    res.json({ html })
  } catch (err) {
    if (err instanceof MaildenoError) {
      return res.status(err.status || 500).json({
        error: err.code,
        message: err.message,
      })
    }
    res.status(500).json({ error: "INTERNAL_ERROR" })
  }
})

app.listen(3300, () => console.log("API listening on :3300"))
```

---

## Usage in different environments

### Node.js (18+)

`fetch` is available globally from Node 18. No polyfill needed.

```ts
import { MaildenoClient } from "maildeno"
const client = new MaildenoClient({ apiKey: process.env.MAILDENO_API_KEY! })
```

### Node.js (< 18)

```bash
npm install node-fetch
```

```ts
import fetch from "node-fetch"
;(globalThis as any).fetch = fetch
import { MaildenoClient } from "maildeno"
```

### Next.js (App Router — server component or route handler)

```ts
// app/api/email/route.ts
import { MaildenoClient } from "maildeno"

const client = new MaildenoClient({
  apiKey:  process.env.MAILDENO_API_KEY!,
})

export async function POST(req: Request) {
  const { templateId, name, plan } = await req.json()

  const html = await client.renderHtml(templateId, {
    merge_tags: { text: { name: name } },
    context:    { plan },
  })

  return Response.json({ html })
}
```

### Nuxt 3 (server route)

```ts
// server/api/render.post.ts
import { MaildenoClient } from "maildeno"

export default defineEventHandler(async (event) => {
  const { templateId, dynamicData } = await readBody(event)
  const config = useRuntimeConfig()

  const client = new MaildenoClient({
    apiKey:  config.maildenoApiKey,
  })

  return client.render({ templateId, target: "html", dynamicData })
})
```

---

## API key scopes

API keys can be scoped to specific targets at creation time:

| Targets value     | Allowed render calls                        |
|-------------------|---------------------------------------------|
| `["all"]`         | `html`, `react-email`, `mjml`               |
| `["html"]`        | `html` only — `react-email` / `mjml` → 403  |
| `["html","mjml"]` | `html` and `mjml` — `react-email` → 403     |

Create scoped keys via the API:
```bash
POST https://api.maildeno.com/api/v1/keys
{ "name": "HTML only", "targets": ["html"] }
```

---

## TypeScript types

All types are exported from the package root:

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
} from "maildeno"
```

---

## License

MIT