# maildeno

Official JavaScript / TypeScript SDK for the **Maildeno** render API.

Fetches template JSON from the Maildeno server, caches it locally (memory or disk), and renders HTML / React Email TSX / MJML **in-process** using an embedded Wasm engine — so your merge tags and dynamic data never leave your server.

---

## Table of contents

- [Installation](#installation)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [How caching works](#how-caching-works)
  - [Cache sequence (Maildeno server → your project)](#cache-sequence-maildeno-server--your-project)
  - [Memory cache](#memory-cache)
  - [Disk cache](#disk-cache)
  - [Stale-on-error fallback](#stale-on-error-fallback)
  - [Cache inspection & management](#cache-inspection--management)
- [Rendering](#rendering)
  - [`render()` — full control](#render--full-control)
  - [Convenience methods](#convenience-methods)
  - [Detecting cache vs server render](#detecting-cache-vs-server-render)
- [Dynamic data](#dynamic-data)
  - [Merge tags](#merge-tags)
  - [Visibility context](#visibility-context)
- [Error handling](#error-handling)
  - [Error codes](#error-codes)
  - [Per-error-type handling](#per-error-type-handling)
  - [Global error handler pattern](#global-error-handler-pattern)
- [Framework examples](#framework-examples)
  - [Express.js](#expressjs)
  - [Next.js (App Router)](#nextjs-app-router)
  - [NestJS](#nestjs)
  - [Fastify](#fastify)
- [TypeScript types](#typescript-types)
- [Changelog](#changelog)

---

## Installation

```bash
npm install maildeno
# or
yarn add maildeno
# or
pnpm add maildeno
```

**Requirements:** Node.js 18+ (uses native `fetch`). No other runtime dependencies.

---

## Quick start

```ts
import { MaildenoClient } from "maildeno"

const client = new MaildenoClient({
  apiKey: "sk_live_4a7f2c8d...",
})

// Render to HTML — template is fetched from Maildeno, cached locally,
// and rendered in-process with the embedded Wasm engine.
const html = await client.renderHtml("550e8400-e29b-41d4-a716-446655440000")
console.log(html) // <!DOCTYPE html>...
```

---

## Configuration

```ts
import { MaildenoClient } from "maildeno"

const client = new MaildenoClient({
  // ── Required ────────────────────────────────────────────────────────────────
  apiKey: "sk_live_...",
  // Obtain from: Maildeno Dashboard → API Keys → Create Key

  // ── Optional ────────────────────────────────────────────────────────────────

  // Base URL of the Maildeno API. Defaults to "https://api.maildeno.com".
  // Override only when proxying through your own infrastructure or running a
  // self-hosted Maildeno instance.
  baseUrl: "https://maildeno-proxy.yourcompany.com", // OPTIONAL

  // Request timeout in milliseconds. Defaults to 30_000 (30 s).
  timeout: 10_000, // OPTIONAL

  // Cache configuration. Omit to use memory caching with default settings.
  // See "How caching works" for the full explanation.
  cache: {
    // "memory" (default) or "disk"
    type: "memory",           // OPTIONAL — defaults to "memory"

    // Directory for disk cache. Required when type is "disk".
    // Created automatically if it doesn't exist.
    path: "/var/cache/maildeno", // OPTIONAL — only used when type="disk"

    // How long a cached template is considered fresh (milliseconds).
    // After TTL expires a re-fetch is attempted in the background.
    // Stale copy is used as fallback if the server is unreachable.
    ttl: 300_000,             // OPTIONAL — defaults to 300_000 (5 minutes)

    // Max template entries before the oldest is evicted.
    maxEntries: 50,           // OPTIONAL — defaults to 50
  },
})
```

> **Tip:** Instantiate the client **once** at application startup and reuse it
> across requests. The cache and the Wasm engine are both attached to the
> client instance.

---

## How caching works

### Cache sequence (Maildeno server → your project)

When you call any render method, the SDK follows this sequence:

```
Your code
   │
   ▼
┌──────────────────────────────────────┐
│  MaildenoClient.renderHtml(id)       │
│                                      │
│  1. Check in-process memory cache ◄──┼── CACHE HIT → render immediately (0 ms)
│                        │             │
│      cache miss        ▼             │
│                                      │
│  2. Check disk cache (if configured) │
│     read .maildeno-cache/<id>.json ◄─┼── CACHE HIT → load into memory, render
│                        │             │
│      cache miss        ▼             │
│                                      │
│  3. Fetch template JSON from         │
│     GET https://api.maildeno.com     │
│         /v1/sdk/template/<id>    ◄───┼── NETWORK CALL (only on first render
│                        │             │   or after TTL expiry)
│      store in cache    ▼             │
│                                      │
│  4. Render template + dynamic data   │
│     in-process with Wasm engine      │
│     (merge tags & context never      │
│     leave your server)               │
└──────────────────────────────────────┘
   │
   ▼
rendered HTML / TSX / MJML string
```

**Key points:**
- The network call to Maildeno happens **at most once per template per TTL window**.
- After the first fetch, every subsequent render is pure CPU — no I/O, no latency.
- The Wasm engine processes your merge tags locally. Your dynamic data is never sent to Maildeno's servers.

---

### Memory cache

The default. Zero configuration required. Lives in the process heap.

```ts
// Defaults — no cache config needed
const client = new MaildenoClient({ apiKey: "sk_live_..." })

// Explicit memory config with custom TTL
const client = new MaildenoClient({
  apiKey: "sk_live_...",
  cache: {
    type: "memory",    // OPTIONAL — "memory" is the default
    ttl: 60_000,       // OPTIONAL — 60 s instead of 5 min
    maxEntries: 100,   // OPTIONAL — hold up to 100 templates
  },
})
```

**When to use:** Always — unless your process restarts frequently (e.g. serverless
functions) and you want the cache to survive restarts.

**Trade-off:** Lost on process exit. Each worker process in a cluster maintains
its own independent cache.

---

### Disk cache

Persists template JSON to the local filesystem. Survives process restarts and
is shared by all workers pointing at the same directory.

```ts
const client = new MaildenoClient({
  apiKey: "sk_live_...",
  cache: {
    type: "disk",
    path: "/var/cache/maildeno", // OPTIONAL — defaults to ".maildeno-cache"
    ttl: 600_000,                // OPTIONAL — 10 min
    maxEntries: 200,             // OPTIONAL
  },
})
```

Each template is stored as a JSON file: `<path>/<template-id>.json`.

The SDK reads each file atomically on cache miss and writes atomically on
re-fetch. Concurrent workers safely read the same files — writes are atomic
renames on POSIX systems.

**When to use:**
- Serverless / short-lived processes (Lambda, Cloud Run, Vercel Functions) where
  cold-start latency from a network fetch is unacceptable.
- Multi-worker Node clusters sharing a filesystem.

---

### Stale-on-error fallback

When a cached template's TTL expires, the SDK attempts a background re-fetch.
If the Maildeno server is unreachable (network error, timeout, 5xx), the SDK:

1. Renders from the **last known-good cached copy** (stale entry).
2. Sets `result.fromStaleCache = true` on the returned `RenderResult`.
3. Does **not** throw — your send pipeline continues uninterrupted.

The SDK only throws when the server is unreachable **and** no prior cached copy
exists for that template (i.e. first-ever render with no cache entry).

```ts
const result = await client.render({
  templateId: "550e8400-e29b-41d4-a716-446655440000",
  target: "html",
})

if (result.fromStaleCache) {
  // OPTIONAL — log or alert that Maildeno was unreachable
  // The output is still valid HTML rendered from the last cached template.
  logger.warn("Rendered from stale cache — Maildeno may be down", {
    templateId: result.templateId,
  })
}
```

---

### Cache inspection & management

```ts
// List template IDs currently held in the cache
const ids = await client.listCached()
// ["550e8400-...", "9ec0c043-..."]

// Remove a single template immediately (e.g. after updating it on the dashboard)
await client.deleteCached("550e8400-e29b-41d4-a716-446655440000")

// Wipe the entire cache
await client.clearCache()
```
---

## Rendering

### `render()` — full control

```ts
import { MaildenoClient } from "maildeno"
import type { RenderResult } from "maildeno"

const client = new MaildenoClient({ apiKey: "sk_live_..." })

const result: RenderResult = await client.render({
  templateId: "550e8400-e29b-41d4-a716-446655440000", // required
  target: "html",       // "html" | "react-email" | "mjml" — OPTIONAL, defaults to "html"
  dynamicData: {        // OPTIONAL — omit if your template has no dynamic content
    merge_tags: {
      text: { firstName: "Noruwa", company: "Maildeno" },
      url:  { unsubscribeUrl: "https://example.com/unsub" },
      attr: { logoAlt: "Maildeno logo" },
    },
    context: {
      isPremium: true,
      planName: "Pro",
    },
  },
})

console.log(result.output)           // rendered string
console.log(result.target)           // "html"
console.log(result.templateId)       // "550e8400-..."
console.log(result.fromStaleCache)   // false (or true if server was unreachable)
```

---

### Convenience methods

These return the rendered **string** directly — no need to destructure `result.output`.

```ts
// Render to HTML
const html = await client.renderHtml(
  "550e8400-e29b-41d4-a716-446655440000",
  {                                  // OPTIONAL — dynamicData
    merge_tags: { text: { name: "Noruwa" } },
  }
)

// Render to React Email TSX
const tsx = await client.renderReact(
  "550e8400-e29b-41d4-a716-446655440000",
  {                                  // OPTIONAL — dynamicData
    merge_tags: { text: { name: "Noruwa" } },
  }
)

// Render to MJML
const mjml = await client.renderMjml(
  "550e8400-e29b-41d4-a716-446655440000",
  {                                  // OPTIONAL — dynamicData
    merge_tags: { text: { name: "Noruwa" } },
  }
)
```

> **Convenience vs `render()`:** Use the convenience methods when you only need
> the output string. Use `render()` when you need `result.fromStaleCache`,
> `result.target`, or `result.templateId`.

---

### Detecting cache vs server render

Use `render()` (not the convenience methods) to get the `fromStaleCache` flag.

```ts
import { MaildenoClient, MaildenoError } from "maildeno"

const client = new MaildenoClient({
  apiKey: process.env.MAILDENO_API_KEY!,
  cache: { ttl: 300_000 },
})

async function sendWelcomeEmail(user: { id: string; name: string; email: string }) {
  const result = await client.render({
    templateId: process.env.WELCOME_TEMPLATE_ID!,
    target: "html",
    dynamicData: {                // OPTIONAL
      merge_tags: {
        text: { firstName: user.name },
      },
      context: {
        isNewUser: true,          // OPTIONAL — drives show/hide rules in template
      },
    },
  })

  // ── Cache diagnostic (OPTIONAL) ──────────────────────────────────────────
  if (result.fromStaleCache) {
    // Template was rendered from a cached copy because Maildeno was unreachable.
    // The output is still valid — log for alerting only.
    console.warn("[maildeno] stale cache used", {
      templateId: result.templateId,
      userId: user.id,
    })
  } else {
    console.debug("[maildeno] rendered fresh", { templateId: result.templateId })
  }
  // ── End cache diagnostic ─────────────────────────────────────────────────

  await emailProvider.send({
    to: user.email,
    subject: "Welcome!",
    html: result.output,
  })
}
```

---

## Dynamic data

All fields are **optional**. Include only what your template actually uses.

### Merge tags

Merge tags replace placeholders in the template's content.

```ts
dynamicData: {
  merge_tags: {
    // Text values — inserted as plain text
    text: {
      firstName:   "Noruwa",
      lastName:    "Obaseki",
      companyName: "Maildeno",
      planName:    "Pro",
    },

    // URL values — used in link hrefs / button targets
    url: {
      ctaUrl:         "https://app.example.com/dashboard",
      unsubscribeUrl: "https://example.com/unsub?token=abc",
      logoUrl:        "https://cdn.example.com/logo.png",
    },

    // Attribute values — used in HTML attributes (alt, title, etc.)
    attr: {
      logoAlt:    "Maildeno Inc.",
      bannerTitle: "Summer Sale",
    },
  },
}
```

### Visibility context

Context values drive **show/hide** rules configured in the Maildeno template
editor. Rows and blocks are shown or hidden based on these boolean/string/number
values — without touching any template code.

```ts
dynamicData: {
  context: {
    isPremium:   true,       // boolean — show premium-only upsell row
    planName:    "Pro",      // string  — show plan-specific content block
    daysLeft:    3,          // number  — show trial-expiry warning when < 7
    hasBalance:  false,      // boolean — hide payment-due row when false
  },
}
```

---

## Error handling

All SDK errors are instances of `MaildenoError`, which extends `Error`.

```ts
import { MaildenoClient, MaildenoError } from "maildeno"

const client = new MaildenoClient({ apiKey: "sk_live_..." })

try {
  const html = await client.renderHtml("550e8400-e29b-41d4-a716-446655440000")
  // use html...
} catch (err) {
  if (err instanceof MaildenoError) {
    console.error(err.code)     // "TEMPLATE_NOT_FOUND" | "INVALID_API_KEY" | ...
    console.error(err.status)   // HTTP status: 401 | 403 | 404 | 422 | 0 (network)
    console.error(err.message)  // Human-reNoruwable description

    // OPTIONAL — structured validation issues (only on RENDER_ERROR / 422)
    if (err.issues?.length) {
      err.issues.forEach(issue => {
        console.error(`  Field: ${issue.loc?.join(".")} — ${issue.msg}`)
      })
    }
  } else {
    throw err // re-throw unexpected errors
  }
}
```

### Error codes

| Code | HTTP | When it happens |
|------|------|-----------------|
| `INVALID_API_KEY` | 401 | API key is missing, malformed, or revoked |
| `FORBIDDEN` | 403 | Key lacks scope for this target, or plan limit reached |
| `TEMPLATE_NOT_FOUND` | 404 | `templateId` does not exist in your account |
| `RENDER_ERROR` | 422 | Template render failed — check `err.issues` for field details |
| `NETWORK_ERROR` | 0 | `fetch()` threw (DNS failure, connection refused, etc.) |
| `TIMEOUT` | 0 | Request exceeded the configured `timeout` |
| `UNKNOWN` | varies | Unexpected response from the server |

### Per-error-type handling

```ts
import { MaildenoClient, MaildenoError } from "maildeno"

const client = new MaildenoClient({ apiKey: process.env.MAILDENO_API_KEY! })

async function renderWithFallback(templateId: string, fallbackHtml: string) {
  try {
    return await client.renderHtml(templateId)

  } catch (err) {
    if (!(err instanceof MaildenoError)) throw err

    switch (err.code) {
      case "TEMPLATE_NOT_FOUND":
        // OPTIONAL — fall back to a hardcoded HTML string
        console.warn(`Template ${templateId} not found, using fallback`)
        return fallbackHtml

      case "INVALID_API_KEY":
        // Configuration error — alert immediately, don't retry
        throw new Error("Maildeno API key is invalid. Check MAILDENO_API_KEY env var.")

      case "FORBIDDEN":
        // Key doesn't have access to this target (e.g. MJML on Free plan)
        throw new Error(`Access denied: ${err.message}`)

      case "RENDER_ERROR":
        // Template has invalid merge tag references or bad config
        // OPTIONAL — log structured issues for debugging
        console.error("Render failed:", err.issues)
        throw err

      case "TIMEOUT":
      case "NETWORK_ERROR":
        // Transient — OPTIONAL: retry with exponential backoff
        console.warn("Maildeno unreachable, retrying in 2s...")
        await new Promise(r => setTimeout(r, 2000))
        return renderWithFallback(templateId, fallbackHtml) // retry once

      default:
        throw err
    }
  }
}
```

### Global error handler pattern

```ts
// lib/maildeno.ts — centralise client & error handling for your whole app
import { MaildenoClient, MaildenoError } from "maildeno"

export const maildeno = new MaildenoClient({
  apiKey: process.env.MAILDENO_API_KEY!,
  cache: {
    type: "disk",                        // OPTIONAL — persist across restarts
    path: "/tmp/maildeno-cache",
    ttl: 300_000,
  },
})

/**
 * Wrap any render call with consistent error handling.
 * Returns null on non-fatal errors (network, timeout) so your
 * email pipeline can skip gracefully instead of crashing.
 */
export async function safeRender(
  templateId: string,
  opts?: { target?: "html" | "react-email" | "mjml"; dynamicData?: object }
): Promise<string | null> {
  try {
    const result = await maildeno.render({
      templateId,
      target: opts?.target ?? "html",
      dynamicData: opts?.dynamicData as any,
    })

    if (result.fromStaleCache) {                   // OPTIONAL diagnostic
      process.emit("maildeno:stale-cache", templateId)
    }

    return result.output
  } catch (err) {
    if (err instanceof MaildenoError) {
      if (err.code === "TIMEOUT" || err.code === "NETWORK_ERROR") {
        console.error("[maildeno] unreachable — skipping render", err.message)
        return null // OPTIONAL — return null instead of crashing
      }
    }
    throw err // fatal errors bubble up
  }
}
```

---

## Framework examples

### Express.js

```ts
// server.ts
import express from "express"
import { MaildenoClient, MaildenoError } from "maildeno"

// Instantiate once at startup — the cache lives on this instance
const maildeno = new MaildenoClient({
  apiKey: process.env.MAILDENO_API_KEY!,
  cache: { ttl: 300_000 },              // OPTIONAL — cache settings
})

const app = express()
app.use(express.json())

// POST /emails/send  { userId, email, name }
app.post("/emails/send", async (req, res) => {
  const { userId, email, name } = req.body

  try {
    const result = await maildeno.render({
      templateId: process.env.WELCOME_TEMPLATE_ID!,
      target: "html",
      dynamicData: {                    // OPTIONAL
        merge_tags: {
          text: { firstName: name },
          url:  { dashboardUrl: `https://app.example.com/u/${userId}` },
        },
        context: { isNewUser: true },   // OPTIONAL — visibility context
      },
    })

    if (result.fromStaleCache) {        // OPTIONAL — log stale cache usage
      req.log?.warn("stale cache", { templateId: result.templateId })
    }

    await emailProvider.send({ to: email, subject: "Welcome!", html: result.output })
    res.json({ sent: true })

  } catch (err) {
    if (err instanceof MaildenoError) {
      // Map SDK error codes to HTTP responses
      const statusMap: Record<string, number> = {
        INVALID_API_KEY:    500,  // config error — don't expose to client
        FORBIDDEN:          500,
        TEMPLATE_NOT_FOUND: 500,
        RENDER_ERROR:       500,
        NETWORK_ERROR:      503,
        TIMEOUT:            503,
      }
      return res.status(statusMap[err.code] ?? 500).json({
        error:  err.code,
        detail: err.message,
      })
    }
    throw err
  }
})

app.listen(3000)
```

---

### Next.js (App Router)

```ts
// app/api/send-email/route.ts
import { NextRequest, NextResponse } from "next/server"
import { MaildenoClient, MaildenoError } from "maildeno"

// Module-level singleton — shared across invocations in the same process
// Note: in serverless environments each instance has its own memory cache.
// Use disk cache if you want persistence.
const maildeno = new MaildenoClient({
  apiKey: process.env.MAILDENO_API_KEY!,
  cache: {
    type: "disk",                       // OPTIONAL — persist across cold starts
    path: "/tmp/maildeno-cache",        // /tmp is writable on Vercel / Lambda
    ttl: 300_000,
  },
})

export async function POST(req: NextRequest) {
  const { templateId, email, dynamicData } = await req.json()

  try {
    const result = await maildeno.render({
      templateId,
      target: "html",
      dynamicData,                      // OPTIONAL — pass through from request
    })

    await sendEmail({ to: email, html: result.output })

    return NextResponse.json({
      success: true,
      fromCache: !result.fromStaleCache && true, // OPTIONAL — expose in response
    })

  } catch (err) {
    if (err instanceof MaildenoError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: err.status || 500 },
      )
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
```

---

### NestJS

```ts
// maildeno.module.ts
import { Module, Global } from "@nestjs/common"
import { MaildenoClient } from "maildeno"

@Global()
@Module({
  providers: [
    {
      provide: "MAILDENO_CLIENT",
      useFactory: () =>
        new MaildenoClient({
          apiKey: process.env.MAILDENO_API_KEY!,
          cache: { ttl: 300_000 },      // OPTIONAL
        }),
    },
  ],
  exports: ["MAILDENO_CLIENT"],
})
export class MaildenoModule {}

// email.service.ts
import { Injectable, Inject, Logger } from "@nestjs/common"
import { MaildenoClient, MaildenoError } from "maildeno"

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name)

  constructor(
    @Inject("MAILDENO_CLIENT") private readonly maildeno: MaildenoClient,
  ) {}

  async sendWelcome(user: { name: string; email: string }) {
    const result = await this.maildeno.render({
      templateId: process.env.WELCOME_TEMPLATE_ID!,
      target: "html",
      dynamicData: {                    // OPTIONAL
        merge_tags: { text: { firstName: user.name } },
      },
    })

    if (result.fromStaleCache) {        // OPTIONAL — stale cache warning
      this.logger.warn(`Stale cache for template ${result.templateId}`)
    }

    await this.emailProvider.send({ to: user.email, html: result.output })
  }
}
```

---

### Fastify

```ts
import Fastify from "fastify"
import { MaildenoClient, MaildenoError } from "maildeno"

const fastify = Fastify({ logger: true })

// Decorate fastify with the client so it's accessible in all routes
fastify.decorate("maildeno", new MaildenoClient({
  apiKey: process.env.MAILDENO_API_KEY!,
  cache: { ttl: 300_000 },            // OPTIONAL
}))

fastify.post<{ Body: { email: string; name: string } }>("/send", async (req, reply) => {
  try {
    const result = await fastify.maildeno.render({
      templateId: "550e8400-e29b-41d4-a716-446655440000",
      target: "html",
      dynamicData: {                  // OPTIONAL
        merge_tags: { text: { name: req.body.name } },
      },
    })

    if (result.fromStaleCache) {      // OPTIONAL
      req.log.warn("rendered from stale cache")
    }

    await send({ to: req.body.email, html: result.output })
    return { ok: true }

  } catch (err) {
    if (err instanceof MaildenoError) {
      return reply.code(502).send({ error: err.code })
    }
    throw err
  }
})

fastify.listen({ port: 3000 })
```

---

## TypeScript types

All public types are exported from the package root:

```ts
import {
  MaildenoClient,
  MaildenoError,
} from "maildeno"

import type {
  MaildenoConfig,   // constructor options
  CacheConfig,      // cache sub-object
  RenderOptions,    // options for client.render()
  RenderResult,     // { output, target, templateId, fromStaleCache }
  RenderTarget,     // "html" | "react-email" | "mjml"
  DynamicData,      // { merge_tags?, context? }
  MergeTagGroup,    // { text?, url?, attr? }
  ContextValue,     // string | number | boolean
  TemplateJson,     // raw shape of GET /v1/sdk/template/:id response
  SdkErrorCode,     // "INVALID_API_KEY" | "FORBIDDEN" | ... (union literal)
  ValidationIssue,  // { loc, msg, type } — entries on MaildenoError.issues
} from "maildeno"
```

---

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for the full version history.

---

## License

MIT