import type { APIKeyResolution } from "./types.js"
import { isRecord } from "./utils.js"

export function getServices(options: unknown): Record<string, unknown> {
  if (!isRecord(options)) {
    return {}
  }

  const maybeServices = options.services
  if (isRecord(maybeServices)) {
    return maybeServices
  }

  return {}
}

export function validateServiceKey(service: string): string | null {
  const normalized = service.trim().toLowerCase()
  if (normalized.length === 0) {
    return null
  }

  if (!/^[a-z0-9][a-z0-9-]*$/.test(normalized)) {
    return null
  }

  return normalized
}

export function normalizeBaseURL(baseURL: unknown): string | null {
  if (typeof baseURL !== "string") {
    return null
  }

  const trimmed = baseURL.trim()
  if (trimmed.length === 0) {
    return null
  }

  try {
    const parsed = new URL(trimmed)
    return parsed.toString().replace(/\/+$/, "")
  } catch {
    return null
  }
}

export function resolveAPIKey(raw: unknown): APIKeyResolution {
  if (typeof raw !== "string") {
    return { mode: "none" }
  }

  const value = raw.trim()
  if (!value) {
    return { mode: "none" }
  }

  const envMatch = value.match(/^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/)
  if (envMatch) {
    const envName = envMatch[1]
    const resolved = process.env[envName]
    return resolved
      ? { mode: "env", envName, key: resolved }
      : { mode: "env", envName }
  }

  return { mode: "literal", key: value }
}
