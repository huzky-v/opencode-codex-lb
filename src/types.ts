import type { PluginInput, PluginOptions } from "@opencode-ai/plugin"

export const SERVICE = "opencode-codex-lb"
export const MODELS_DEV_URL = "https://models.dev/api.json"
export const OPENAI_PROVIDER_ID = "openai"
export const SERVICE_PROVIDER_PREFIX = "codex-lb"

export const MODEL_FIELDS = [
  "family",
  "release_date",
  "attachment",
  "reasoning",
  "reasoning_options",
  "temperature",
  "tool_call",
  "interleaved",
  "cost",
  "limit",
  "modalities",
  "status",
] as const

export type LogLevel = "debug" | "info" | "warn" | "error"
export type AppClient = PluginInput["client"]

export type ServiceDefinition = {
  baseURL: string
  apiKey?: string
}

export type CodexLBOptions = PluginOptions & {
  services?: Record<string, ServiceDefinition>
}

export type ModelConfig = Record<string, unknown>
export type ModelMap = Record<string, ModelConfig>

export type ProviderConfig = {
  npm: string
  name: string
  options: Record<string, unknown>
  env?: string[]
  models: ModelMap
}

export type DiscoveryResult =
  | { ok: true; ids: Set<string> }
  | { ok: false; reason: "request_failed" | "invalid_payload"; detail: string }

export type APIKeyResolution =
  | { mode: "none" }
  | { mode: "literal"; key: string }
  | { mode: "env"; envName: string; key?: string }

export type ServiceBuildResult =
  | {
      status: "ok"
      providerID: string
      provider: ProviderConfig
    }
  | {
      status: "skip"
      service: string
      reason: string
    }
