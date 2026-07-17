import { describe, expect, mock, test } from "bun:test"
import {
  detectUsageSupport,
  fetchPooledUsage,
  parseCodexLBVersion,
  parsePooledUsage,
  supportsUsageAPI,
} from "../src/usage"
mock.module("@opentui/solid/jsx-runtime", () => ({
  Fragment: Symbol("Fragment"),
  jsx: () => undefined,
  jsxDEV: () => undefined,
  jsxs: () => undefined,
}))

const {
  hasUsageValue,
  getUsageSupport,
  isUsageSupportCacheFresh,
  resolveActiveProviderID,
  resolveLatestMessageContext,
  resolveProviderCredentials,
  sessionIDFromUpdatedEvent,
  shouldFetchUsage,
  formatUsagePercentage,
  usageTrack,
} = await import("../src/tui")

const response = (body: unknown, headers: Record<string, string> = {}, ok = true) =>
  new Response(JSON.stringify(body), {
    status: ok ? 200 : 401,
    headers: { "content-type": "application/json", ...headers },
  })

const responseWithCancellation = (
  body: unknown,
  headers: Record<string, string> = {},
  ok = true,
  stallJSON = false,
) => {
  let cancelled = false
  let resolveJSON: ((value: unknown) => void) | undefined
  const response = {
    ok,
    headers: new Headers(headers),
    bodyUsed: false,
    body: {
      cancel: async () => {
        cancelled = true
        resolveJSON?.(body)
      },
    } as unknown as ReadableStream<Uint8Array>,
    json: stallJSON
      ? () => new Promise<unknown>((resolve) => {
          resolveJSON = resolve
        })
      : async () => body,
  } as unknown as Response

  return {
    response,
    wasCancelled: () => cancelled,
  }
}

describe("parseCodexLBVersion", () => {
  test("accepts the codex-lb header formats", () => {
    expect(parseCodexLBVersion("1.20.0")).toEqual({
      major: 1,
      minor: 20,
      patch: 0,
      prerelease: undefined,
    })
    expect(parseCodexLBVersion("v1.21.0-beta.3")).toEqual({
      major: 1,
      minor: 21,
      patch: 0,
      prerelease: "beta.3",
    })
  })

  test("rejects missing and malformed headers", () => {
    expect(parseCodexLBVersion(null)).toBeUndefined()
    expect(parseCodexLBVersion("codex-lb/1.21")).toBeUndefined()
  })
})

describe("supportsUsageAPI", () => {
  test("requires the 1.21 capability line", () => {
    expect(supportsUsageAPI("1.20.9")).toBe(false)
    expect(supportsUsageAPI("1.21.0-beta.1")).toBe(true)
    expect(supportsUsageAPI("1.21.0")).toBe(true)
    expect(supportsUsageAPI("2.0.0")).toBe(true)
    expect(supportsUsageAPI(null)).toBe(false)
  })
})

describe("parsePooledUsage", () => {
  test("reads pooled remaining percentages", () => {
    expect(
      parsePooledUsage({
        account_pool_usage: { primary: 82.5, secondary: 64 },
      }),
    ).toEqual({ primary: 82.5, secondary: 64 })
  })

  test("preserves null windows and clamps numeric windows", () => {
    expect(
      parsePooledUsage({
        account_pool_usage: { primary: -5, secondary: 140 },
      }),
    ).toEqual({ primary: 0, secondary: 100 })
    expect(
      parsePooledUsage({
        account_pool_usage: { primary: null, secondary: null },
      }),
    ).toEqual({ primary: null, secondary: null })
  })

  test("rejects missing and malformed pooled usage", () => {
    expect(parsePooledUsage({})).toBeUndefined()
    expect(parsePooledUsage({ account_pool_usage: { primary: "82" } })).toBeUndefined()
    expect(parsePooledUsage(null)).toBeUndefined()
  })
})

describe("TUI provider resolution", () => {
  test("prefers the session model over the configured agent model", () => {
    expect(
      resolveActiveProviderID(
        { model: { providerID: "codex-lb-paid" }, agent: "build" },
        { model: "codex-lb-free/gpt-5", agent: { build: { model: "codex-lb-build/gpt-5" } } },
      ),
    ).toBe("codex-lb-paid")
  })

  test("falls back to the configured agent model", () => {
    expect(
      resolveActiveProviderID(
        { agent: "build" },
        { agent: { build: { model: "codex-lb-build/gpt-5" } } },
      ),
    ).toBe("codex-lb-build")
  })

  test("falls back to the global configured model", () => {
    expect(
      resolveActiveProviderID(
        { agent: "build" },
        { model: "codex-lb-global/gpt-5", agent: { build: undefined } },
      ),
    ).toBe("codex-lb-global")
  })

  test("skips model references with an empty provider prefix", () => {
    expect(
      resolveActiveProviderID(
        { agent: "build" },
        { model: "codex-lb-global/gpt-5", agent: { build: { model: "/gpt-5" } } },
      ),
    ).toBe("codex-lb-global")
    expect(
      resolveActiveProviderID(
        { agent: "build" },
        { agent: { build: { model: "/gpt-5" } } },
      ),
    ).toBeUndefined()
  })

  test("resolves a literal provider key", () => {
    expect(
      resolveProviderCredentials({
        env: [],
        options: { baseURL: " https://lb.example/v1 ", apiKey: " literal " },
      }),
    ).toEqual({ baseURL: "https://lb.example/v1", apiKey: "literal" })
  })

  test("prefers the provider key over configured key sources", () => {
    expect(
      resolveProviderCredentials({
        key: " provider-key ",
        env: [],
        options: { baseURL: "https://lb.example/v1", apiKey: "option-key" },
      }),
    ).toEqual({ baseURL: "https://lb.example/v1", apiKey: "provider-key" })
  })

  test("resolves the first non-empty environment-backed key and cleans it up", () => {
    const firstName = "OPENCODE_CODEX_LB_TEST_EMPTY"
    const secondName = "OPENCODE_CODEX_LB_TEST_KEY"
    const previousFirst = process.env[firstName]
    const previousSecond = process.env[secondName]

    try {
      process.env[firstName] = "   "
      process.env[secondName] = " env-key "
      expect(
        resolveProviderCredentials({
          env: [firstName, secondName],
          options: { baseURL: "https://lb.example/v1" },
        }),
      ).toEqual({ baseURL: "https://lb.example/v1", apiKey: "env-key" })
    } finally {
      if (previousFirst === undefined) {
        delete process.env[firstName]
      } else {
        process.env[firstName] = previousFirst
      }
      if (previousSecond === undefined) {
        delete process.env[secondName]
      } else {
        process.env[secondName] = previousSecond
      }
    }
  })

  test("returns undefined when the base URL or key is missing", () => {
    expect(
      resolveProviderCredentials({
        env: [],
        options: { apiKey: "key" },
      }),
    ).toBeUndefined()
    expect(
      resolveProviderCredentials({
        env: [],
        options: { baseURL: "https://lb.example/v1" },
      }),
    ).toBeUndefined()
  })
})

describe("TUI usage track", () => {
  test("formats usage percentages to one decimal place", () => {
    expect(formatUsagePercentage(82.55)).toBe("82.6")
    expect(formatUsagePercentage(64)).toBe("64.0")
    expect(formatUsagePercentage(82.54)).toBe("82.5")
  })

  test("renders a fixed 20-character remaining-capacity track", () => {
    expect(usageTrack(75)).toBe("###############-----")
    expect(usageTrack(0)).toBe("--------------------")
    expect(usageTrack(100)).toBe("####################")
  })
})

describe("TUI usage visibility", () => {
  test("shows only when at least one pooled window has a value", () => {
    expect(hasUsageValue(undefined)).toBe(false)
    expect(hasUsageValue(null)).toBe(false)
    expect(hasUsageValue(0)).toBe(true)
  })
})

describe("TUI usage refresh", () => {
  test("does not immediately refetch usage retained across a view remount", () => {
    const identity = "codex-lb-paid\nhttps://lb.example/v1\nkey"

    expect(shouldFetchUsage(identity, { identity, usage: { primary: null, secondary: 76 } })).toBe(false)
    expect(shouldFetchUsage(identity, { identity, usage: undefined })).toBe(true)
    expect(
      shouldFetchUsage(identity, {
        identity: "codex-lb-free\nhttps://lb.example/v1\nother-key",
        usage: { primary: 80, secondary: null },
      }),
    ).toBe(true)
  })
})

describe("TUI message context", () => {
  test("prefers the newest assistant provider and keeps its agent", () => {
    expect(
      resolveLatestMessageContext([
        { role: "user", agent: "build", model: { providerID: "codex-lb-user" } },
        { role: "assistant", agent: "build", providerID: "codex-lb-assistant" },
      ]),
    ).toEqual({ model: { providerID: "codex-lb-assistant" }, agent: "build" })
  })

  test("uses a user model when no newer assistant provider exists", () => {
    expect(
      resolveLatestMessageContext([{ role: "user", agent: "build", model: { providerID: "codex-lb-user" } }]),
    ).toEqual({ model: { providerID: "codex-lb-user" }, agent: "build" })
  })

  test("keeps the newest message agent when provider data is unavailable", () => {
    expect(resolveLatestMessageContext([{ role: "user", agent: "build" }])).toEqual({ agent: "build" })
  })
})

describe("TUI support cache expiry", () => {
  test("treats entries as fresh only before their expiry time", () => {
    expect(isUsageSupportCacheFresh(1001, 1000)).toBe(true)
    expect(isUsageSupportCacheFresh(1000, 1000)).toBe(false)
  })

  test("bounds entries and promotes cache hits to most-recently-used", async () => {
    const previousFetch = globalThis.fetch
    let requests = 0
    globalThis.fetch = async () => {
      requests += 1
      return response({}, { "x-app-version": "1.21.0" })
    }

    try {
      const signal = new AbortController().signal
      for (let index = 0; index < 8; index += 1) {
        await getUsageSupport(`https://lb.example/cache/${index}`, "key", signal)
      }
      await getUsageSupport("https://lb.example/cache/0", "key", signal)
      await getUsageSupport("https://lb.example/cache/8", "key", signal)
      await getUsageSupport("https://lb.example/cache/1", "key", signal)

      expect(requests).toBe(10)
    } finally {
      globalThis.fetch = previousFetch
    }
  })
})

describe("TUI session events", () => {
  test("reads the session identity from session.updated info", () => {
    expect(sessionIDFromUpdatedEvent({ properties: { info: { id: "session-1" } } })).toBe("session-1")
  })
})

describe("usage HTTP client", () => {
  test("detects support from X-App-Version using only /models", async () => {
    const urls: string[] = []
    const fetcher: typeof fetch = async (input) => {
      urls.push(String(input))
      return response({}, { "x-app-version": "1.21.0-beta.3" })
    }

    await expect(
      detectUsageSupport("https://lb.example/v1", "key", { fetcher }),
    ).resolves.toBe(true)
    expect(urls).toEqual(["https://lb.example/v1/models"])
  })

  test("does not enable usage for old or headerless servers", async () => {
    await expect(
      detectUsageSupport("https://lb.example/v1", "key", {
        fetcher: async () => response({}, { "x-app-version": "1.20.0" }),
      }),
    ).resolves.toBe(false)
    await expect(
      detectUsageSupport("https://lb.example/v1", "key", {
        fetcher: async () => response({}),
      }),
    ).resolves.toBe(false)
    await expect(
      detectUsageSupport("https://lb.example/v1", "key", {
        fetcher: async () => response({}, { "x-app-version": "not-a-version" }),
      }),
    ).resolves.toBe(false)
  })

  test("returns undefined for transient network probe failures", async () => {
    await expect(
      detectUsageSupport("https://lb.example/v1", "key", {
        fetcher: async () => {
          throw new Error("network unavailable")
        },
      }),
    ).resolves.toBeUndefined()
  })

  test("returns undefined for non-successful probe responses", async () => {
    await expect(
      detectUsageSupport("https://lb.example/v1", "key", {
        fetcher: async () => response({}, {}, false),
      }),
    ).resolves.toBeUndefined()
  })

  test("fetches pooled usage from the same authenticated base URL", async () => {
    let request: Request | undefined
    const usage = await fetchPooledUsage("https://lb.example/v1", "key", {
      fetcher: async (input, init) => {
        request = new Request(input, init)
        return response({ account_pool_usage: { primary: 75, secondary: 50 } })
      },
    })

    expect(usage).toEqual({ primary: 75, secondary: 50 })
    expect(request?.url).toBe("https://lb.example/v1/usage")
    expect(request?.headers.get("authorization")).toBe("Bearer key")
  })

  test("times out when the response body stalls", async () => {
    const stalled = responseWithCancellation({}, {}, true, true)
    const result = await Promise.race([
      fetchPooledUsage("https://lb.example/v1", "key", {
        timeoutMs: 10,
        fetcher: async () => stalled.response,
      }),
      new Promise<"deadline">((resolve) => setTimeout(() => resolve("deadline"), 100)),
    ])

    expect(result).toBeUndefined()
    expect(stalled.wasCancelled()).toBe(true)
  })

  test("aborts a stalled response body when the caller signal aborts", async () => {
    const stalled = responseWithCancellation({}, {}, true, true)
    const signal = new AbortController()
    const result = await Promise.race([
      fetchPooledUsage("https://lb.example/v1", "key", {
        signal: signal.signal,
        fetcher: async () => {
          setTimeout(() => signal.abort(), 0)
          return stalled.response
        },
      }),
      new Promise<"deadline">((resolve) => setTimeout(() => resolve("deadline"), 100)),
    ])

    expect(result).toBeUndefined()
    expect(stalled.wasCancelled()).toBe(true)
  })

  test("cancels successful probe response bodies", async () => {
    const probe = responseWithCancellation({}, { "x-app-version": "1.21.0" })

    await expect(
      detectUsageSupport("https://lb.example/v1", "key", {
        fetcher: async () => probe.response,
      }),
    ).resolves.toBe(true)
    expect(probe.wasCancelled()).toBe(true)
  })

  test("cancels non-success response bodies and fails closed", async () => {
    const failed = responseWithCancellation({}, {}, false)

    await expect(
      fetchPooledUsage("https://lb.example/v1", "key", {
        fetcher: async () => failed.response,
      }),
    ).resolves.toBeUndefined()
    expect(failed.wasCancelled()).toBe(true)
  })

  test("preserves the base URL path and query for both endpoints", async () => {
    const urls: string[] = []
    const fetcher: typeof fetch = async (input) => {
      urls.push(String(input))
      return response({}, { "x-app-version": "1.21.0" })
    }

    await detectUsageSupport("https://lb.example/v1?tenant=a", "key", { fetcher })
    await fetchPooledUsage("https://lb.example/v1?tenant=a", "key", { fetcher })

    expect(urls).toEqual([
      "https://lb.example/v1/models?tenant=a",
      "https://lb.example/v1/usage?tenant=a",
    ])
  })
})
