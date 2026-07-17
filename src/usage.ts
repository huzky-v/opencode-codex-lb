import { isRecord } from "./utils.js"

const DEFAULT_TIMEOUT_MS = 15_000
const USAGE_API_VERSION = { major: 1, minor: 21, patch: 0 }
const VERSION_PATTERN =
  /^v?([0-9]+)\.([0-9]+)\.([0-9]+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

export type CodexLBVersion = {
  major: number
  minor: number
  patch: number
  prerelease?: string
}

export type PooledUsage = {
  primary: number | null
  secondary: number | null
}

type RequestOptions = {
  fetcher?: typeof fetch
  signal?: AbortSignal
  timeoutMs?: number
}

export function parseCodexLBVersion(value: string | null): CodexLBVersion | undefined {
  if (value === null) {
    return undefined
  }

  const match = VERSION_PATTERN.exec(value)
  if (!match) {
    return undefined
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4],
  }
}

export function supportsUsageAPI(value: string | null): boolean {
  const version = parseCodexLBVersion(value)
  if (!version) {
    return false
  }

  if (version.major !== USAGE_API_VERSION.major) {
    return version.major > USAGE_API_VERSION.major
  }
  if (version.minor !== USAGE_API_VERSION.minor) {
    return version.minor > USAGE_API_VERSION.minor
  }
  return version.patch >= USAGE_API_VERSION.patch
}

export function parsePooledUsage(value: unknown): PooledUsage | undefined {
  if (!isRecord(value) || !isRecord(value.account_pool_usage)) {
    return undefined
  }

  const primary = parseUsageWindow(value.account_pool_usage.primary)
  const secondary = parseUsageWindow(value.account_pool_usage.secondary)
  if (primary === undefined || secondary === undefined) {
    return undefined
  }

  return { primary, secondary }
}

function parseUsageWindow(value: unknown): number | null | undefined {
  if (value === null) {
    return null
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined
  }
  return Math.max(0, Math.min(100, value))
}

function getEndpoint(baseURL: string, resource: "models" | "usage"): string {
  const endpoint = new URL(baseURL)
  const pathname = endpoint.pathname.replace(/\/+$/, "")
  endpoint.pathname = `${pathname}/${resource}`
  return endpoint.toString()
}

async function cancelResponseBody(response: Response | undefined): Promise<void> {
  try {
    if (response) {
      await response.body?.cancel()
    }
  } catch {
    // Body cleanup is best effort after a failed request.
  }
}

async function request<T>(
  url: string,
  apiKey: string,
  options: RequestOptions,
  handleResponse: (response: Response) => Promise<T>,
): Promise<T | undefined> {
  if (options.signal?.aborted) {
    return undefined
  }

  const controller = new AbortController()
  const fetcher = options.fetcher ?? fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  let timeout: ReturnType<typeof setTimeout> | undefined
  let rejectAbort: ((reason?: unknown) => void) | undefined
  let activeResponse: Response | undefined

  const abortRequest = (message: string) => {
    controller.abort()
    void cancelResponseBody(activeResponse)
    rejectAbort?.(new Error(message))
  }

  const onAbort = () => abortRequest("Request aborted")
  const abortPromise = options.signal
    ? new Promise<never>((_, reject) => {
        rejectAbort = reject
        if (options.signal?.aborted) {
          onAbort()
        } else {
          options.signal?.addEventListener("abort", onAbort, { once: true })
        }
      })
    : undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      abortRequest("Request timed out")
      reject(new Error("Request timed out"))
    }, timeoutMs)
  })

  try {
    const operation = (async () => {
      if (controller.signal.aborted) {
        return undefined
      }

      const response = await fetcher(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        signal: controller.signal,
      })

      if (controller.signal.aborted) {
        await cancelResponseBody(response)
        return undefined
      }

      activeResponse = response
      try {
        return await handleResponse(response)
      } finally {
        await cancelResponseBody(response)
        activeResponse = undefined
      }
    })()
    const pending = abortPromise
      ? [operation, timeoutPromise, abortPromise]
      : [operation, timeoutPromise]
    return await Promise.race(pending)
  } catch {
    return undefined
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout)
    }
    options.signal?.removeEventListener("abort", onAbort)
  }
}

export async function detectUsageSupport(
  baseURL: string,
  apiKey: string,
  options: RequestOptions = {},
): Promise<boolean | undefined> {
  try {
    return await request(
      getEndpoint(baseURL, "models"),
      apiKey,
      options,
      async (response) => {
        if (!response.ok) {
          return undefined
        }
        return supportsUsageAPI(response.headers.get("x-app-version"))
      },
    )
  } catch {
    return undefined
  }
}

export async function fetchPooledUsage(
  baseURL: string,
  apiKey: string,
  options: RequestOptions = {},
): Promise<PooledUsage | undefined> {
  try {
    return await request(
      getEndpoint(baseURL, "usage"),
      apiKey,
      options,
      async (response) => {
        if (!response.ok) {
          return undefined
        }
        return parsePooledUsage(await response.json())
      },
    )
  } catch {
    return undefined
  }
}
