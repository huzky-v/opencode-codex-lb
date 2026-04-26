import type { DiscoveryResult } from "./types.js"
import { isRecord } from "./utils.js"

export async function fetchJSON(
  url: string,
  init: RequestInit = {},
  timeoutMs = 15_000,
): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`)
    }

    return await response.json()
  } finally {
    clearTimeout(timeout)
  }
}

export function getModelsEndpoint(baseURL: string): string {
  const base = baseURL.endsWith("/") ? baseURL : `${baseURL}/`
  return new URL("models", base).toString()
}

export function parseLiveModelIDs(payload: unknown): string[] | null {
  let rawList: unknown[]

  if (Array.isArray(payload)) {
    rawList = payload
  } else if (isRecord(payload) && Array.isArray(payload.data)) {
    rawList = payload.data
  } else {
    return null
  }

  const ids = new Set<string>()
  for (const entry of rawList) {
    if (typeof entry === "string" && entry.trim().length > 0) {
      ids.add(entry)
      continue
    }

    if (isRecord(entry) && typeof entry.id === "string" && entry.id.trim()) {
      ids.add(entry.id)
    }
  }

  return [...ids]
}

export async function discoverLiveModels(
  baseURL: string,
  apiKey: string,
): Promise<DiscoveryResult> {
  const endpoint = getModelsEndpoint(baseURL)

  let payload: unknown
  try {
    payload = await fetchJSON(
      endpoint,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
      },
      15_000,
    )
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      reason: "request_failed",
      detail,
    }
  }

  const parsed = parseLiveModelIDs(payload)
  if (!parsed) {
    return {
      ok: false,
      reason: "invalid_payload",
      detail: "Expected /models payload with array or { data: [] }",
    }
  }

  return {
    ok: true,
    ids: new Set(parsed),
  }
}
