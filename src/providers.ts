import { Model, Provider } from "@opencode/plugin"
import { discoverLiveModels } from "./discovery.js"
import { log } from "./logger.js"
import { fetchMirroredModels } from "./models.js"
import {
  getServices,
  normalizeBaseURL,
  resolveAPIKey,
  validateServiceKey,
} from "./options.js"
import {
  SERVICE_PROVIDER_PREFIX,
  type APIKeyResolution,
  type BuiltProvider,
  type DiscoveryResult,
  type ModelConfig,
  type ModelMap,
  type ServiceBuildResult,
} from "./types.js"
import { isRecord } from "./utils.js"

const OPENAI_COMPATIBLE_PACKAGE = "@opencode/ai/providers/openai-compatible"
const GROUP_PROVIDER_ID = SERVICE_PROVIDER_PREFIX

function servicesFromProviderList(providers: readonly unknown[]): Record<string, unknown> {
  const prefixed: Record<string, unknown> = {}
  let grouped: Record<string, unknown> = {}

  for (const provider of providers) {
    if (!isRecord(provider) || typeof provider.id !== "string") continue
    const settings = isRecord(provider.settings) ? provider.settings : {}
    const options = isRecord(settings.options) ? settings.options : {}

    if (provider.id === GROUP_PROVIDER_ID) {
      const services = isRecord(settings.services)
        ? settings.services
        : isRecord(options.services)
          ? options.services
          : undefined
      if (services) grouped = services
      continue
    }

    const prefix = `${SERVICE_PROVIDER_PREFIX}-`
    if (!provider.id.startsWith(prefix)) continue

    const baseURL = typeof settings.baseURL === "string" ? settings.baseURL : options.baseURL
    const apiKey = typeof settings.apiKey === "string" ? settings.apiKey : options.apiKey
    prefixed[provider.id.slice(prefix.length)] = {
      ...(typeof baseURL === "string" ? { baseURL } : {}),
      ...(typeof apiKey === "string" ? { apiKey } : {}),
    }
  }

  return { ...prefixed, ...grouped }
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  const number = finiteNumber(value)
  return number !== undefined && number >= 0 ? Math.floor(number) : fallback
}

function modelCost(raw: unknown): Array<Record<string, unknown>> {
  if (!isRecord(raw)) return []

  const cache = isRecord(raw.cache) ? raw.cache : {}
  const input = finiteNumber(raw.input)
  const output = finiteNumber(raw.output)
  const cacheRead = finiteNumber(raw.cache_read) ?? finiteNumber(cache.read)
  const cacheWrite = finiteNumber(raw.cache_write) ?? finiteNumber(cache.write)
  if (input === undefined && output === undefined && cacheRead === undefined && cacheWrite === undefined) return []

  return [{
    input: input ?? 0,
    output: output ?? 0,
    cache: { read: cacheRead ?? 0, write: cacheWrite ?? 0 },
  }]
}

function modelVariants(raw: unknown): Array<Record<string, unknown>> {
  if (!isRecord(raw)) return []
  return Object.entries(raw).map(([id, variant]) => ({
    id,
    ...(isRecord(variant) ? { settings: variant } : {}),
  }))
}

export function toOpenCodeModelInfo(
  providerID: string,
  modelID: string,
  config: ModelConfig,
): Model.Info {
  const provider = Provider.ID.make(providerID)
  const model = {
    ...Model.Info.default(provider, modelID as Model.ID),
  } as unknown as Record<string, unknown>

  if (typeof config.name === "string" && config.name.trim()) model.name = config.name
  if (typeof config.family === "string") model.family = config.family

  if (typeof config.release_date === "string") {
    const released = Date.parse(config.release_date)
    if (Number.isFinite(released)) model.time = { released }
  }

  const modalities = isRecord(config.modalities) ? config.modalities : {}
  const capabilities = { ...(model.capabilities as Record<string, unknown>) }
  if (Array.isArray(modalities.input)) {
    capabilities.input = modalities.input.filter((value): value is string => typeof value === "string")
  }
  if (Array.isArray(modalities.output)) {
    capabilities.output = modalities.output.filter((value): value is string => typeof value === "string")
  }
  if (config.attachment === true && Array.isArray(capabilities.input) && !capabilities.input.includes("image")) {
    capabilities.input = [...capabilities.input, "image"]
  }
  if (typeof config.tool_call === "boolean") capabilities.tools = config.tool_call
  model.capabilities = capabilities

  if (typeof config.status === "string" && ["alpha", "beta", "deprecated", "active"].includes(config.status)) {
    model.status = config.status
  }

  const cost = modelCost(config.cost)
  if (cost.length > 0) model.cost = cost

  if (isRecord(config.limit)) {
    const limit = model.limit as Record<string, unknown>
    limit.context = nonNegativeInteger(config.limit.context, Number(limit.context))
    limit.output = nonNegativeInteger(config.limit.output, Number(limit.output))
    if (config.limit.input !== undefined) {
      limit.input = nonNegativeInteger(config.limit.input, Number(limit.context))
    }
  }

  const settings: Record<string, unknown> = {}
  for (const key of ["temperature", "reasoning", "reasoning_options", "interleaved"] as const) {
    if (config[key] !== undefined) settings[key] = config[key]
  }
  if (Object.keys(settings).length > 0) model.settings = settings

  const variants = modelVariants(config.variants)
  if (variants.length > 0) model.variants = variants

  return model as unknown as Model.Info
}

function buildProviderInfo(
  service: string,
  baseURL: string,
  apiKey: APIKeyResolution,
): Provider.Info {
  const settings: Record<string, unknown> = { baseURL }
  if (apiKey.mode === "literal" || (apiKey.mode === "env" && apiKey.key)) {
    settings.apiKey = apiKey.key
  }

  return {
    ...Provider.Info.empty(Provider.ID.make(`${SERVICE_PROVIDER_PREFIX}-${service}`)),
    name: `Codex LB (${service})`,
    activation: "enabled",
    package: OPENAI_COMPATIBLE_PACKAGE,
    settings,
  }
}

async function buildServiceProvider(
  serviceKey: string,
  rawService: unknown,
  mirroredModels: ModelMap | null,
): Promise<ServiceBuildResult> {
  const normalizedService = validateServiceKey(serviceKey)
  if (!normalizedService) {
    await log("warn", "Invalid service config", {
      service: serviceKey,
      reason: "Service key must match /^[a-z0-9][a-z0-9-]*$/",
    })
    return { status: "skip", service: serviceKey, reason: "invalid_service_key" }
  }

  if (!isRecord(rawService)) {
    await log("warn", "Invalid service config", {
      service: normalizedService,
      reason: "Service value must be an object",
    })
    return { status: "skip", service: normalizedService, reason: "invalid_service_shape" }
  }

  const baseURL = normalizeBaseURL(rawService.baseURL)
  if (!baseURL) {
    await log("warn", "Invalid service config", {
      service: normalizedService,
      reason: "baseURL must be a valid URL",
    })
    return { status: "skip", service: normalizedService, reason: "invalid_base_url" }
  }

  if (rawService.apiKey !== undefined && rawService.apiKey !== null && typeof rawService.apiKey !== "string") {
    await log("warn", "Invalid service config", {
      service: normalizedService,
      reason: "apiKey must be a string when present",
    })
    return { status: "skip", service: normalizedService, reason: "invalid_api_key" }
  }

  const apiKey = resolveAPIKey(rawService.apiKey)
  if (apiKey.mode === "env" && !apiKey.key) {
    await log("warn", "Missing env var for discovery", {
      service: normalizedService,
      env: apiKey.envName,
    })
  }

  const discoveryKey = apiKey.mode === "literal" ? apiKey.key : apiKey.mode === "env" ? apiKey.key : undefined
  let liveDiscovery: DiscoveryResult | null = null
  if (discoveryKey) {
    liveDiscovery = await discoverLiveModels(baseURL, discoveryKey)
    if (!liveDiscovery.ok) {
      await log(
        "warn",
        liveDiscovery.reason === "invalid_payload" ? "Invalid /models payload" : "Failed /models fetch",
        { service: normalizedService, baseURL, detail: liveDiscovery.detail },
      )
    }
  }

  const liveIDs = liveDiscovery?.ok ? liveDiscovery.ids : null
  if (mirroredModels === null && liveIDs === null) {
    await log("warn", "Skipping service without model catalog", {
      service: normalizedService,
      reason: "Both models.dev mirroring and live /models discovery unavailable",
    })
    return { status: "skip", service: normalizedService, reason: "no_catalog_data" }
  }

  const finalModels: ModelMap = {}
  if (liveIDs) {
    for (const modelID of liveIDs) {
      finalModels[modelID] = mirroredModels?.[modelID] ?? { name: modelID }
    }
  } else if (mirroredModels) {
    Object.assign(finalModels, mirroredModels)
  }

  const providerID = `${SERVICE_PROVIDER_PREFIX}-${normalizedService}`
  const models = Object.entries(finalModels).map(([modelID, config]) =>
    toOpenCodeModelInfo(providerID, modelID, config),
  )

  return {
    status: "ok",
    provider: {
      providerID,
      info: buildProviderInfo(normalizedService, baseURL, apiKey),
      models,
    },
  }
}

export async function buildProviders(
  options: unknown,
  configuredProviders: readonly unknown[],
): Promise<BuiltProvider[]> {
  const services = { ...getServices(options), ...servicesFromProviderList(configuredProviders) }
  if (Object.keys(services).length === 0) {
    await log("warn", "Invalid service config", { reason: "No services configured" })
    return []
  }

  const mirroredModels = await fetchMirroredModels()
  const settled = await Promise.allSettled(
    Object.entries(services).map(([serviceKey, serviceConfig]) =>
      buildServiceProvider(serviceKey, serviceConfig, mirroredModels),
    ),
  )

  const providers: BuiltProvider[] = []
  for (const result of settled) {
    if (result.status === "rejected") {
      await log("warn", "Service provider build failed", {
        detail: result.reason instanceof Error ? result.reason.message : String(result.reason),
      })
      continue
    }
    if (result.value.status === "ok") providers.push(result.value.provider)
  }

  return providers
}
