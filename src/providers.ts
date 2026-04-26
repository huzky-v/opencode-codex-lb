import type { Config, PluginInput } from "@opencode-ai/plugin"
import { discoverLiveModels } from "./discovery.js"
import { log } from "./logger.js"
import { fetchMirroredModels, cloneModelMap } from "./models.js"
import {
  getServices,
  normalizeBaseURL,
  resolveAPIKey,
  validateServiceKey,
} from "./options.js"
import {
  SERVICE_PROVIDER_PREFIX,
  type APIKeyResolution,
  type ModelMap,
  type ProviderConfig,
  type ServiceBuildResult,
} from "./types.js"
import { cloneValue, isRecord } from "./utils.js"

const GROUP_PROVIDER_ID = SERVICE_PROVIDER_PREFIX

function buildProviderID(service: string): string {
  return `${SERVICE_PROVIDER_PREFIX}-${service}`
}

function getConfigProviders(config: Config): Record<string, unknown> {
  if (!isRecord(config.provider)) {
    return {}
  }
  return config.provider as Record<string, unknown>
}

function extractServicesFromGroupProvider(input: unknown): {
  services: Record<string, unknown>
  used: boolean
} {
  if (!isRecord(input)) {
    return { services: {}, used: false }
  }

  const options = isRecord(input.options) ? input.options : undefined
  if (options && isRecord(options.services)) {
    return {
      services: options.services,
      used: true,
    }
  }

  return { services: {}, used: false }
}

function extractServicesFromPrefixedProviders(configProviders: Record<string, unknown>): Record<string, unknown> {
  const prefix = `${SERVICE_PROVIDER_PREFIX}-`
  const services: Record<string, unknown> = {}

  for (const [providerID, providerValue] of Object.entries(configProviders)) {
    if (!providerID.startsWith(prefix)) {
      continue
    }

    const serviceID = providerID.slice(prefix.length)
    if (!serviceID) {
      continue
    }

    if (!isRecord(providerValue)) {
      services[serviceID] = {}
      continue
    }

    const providerOptions = isRecord(providerValue.options) ? providerValue.options : {}
    const baseURL =
      typeof providerOptions.baseURL === "string"
        ? providerOptions.baseURL
        : typeof providerValue.baseURL === "string"
          ? providerValue.baseURL
          : undefined

    const apiKey =
      typeof providerOptions.apiKey === "string"
        ? providerOptions.apiKey
        : typeof providerValue.apiKey === "string"
          ? providerValue.apiKey
          : undefined

    services[serviceID] = {
      ...(baseURL !== undefined ? { baseURL } : {}),
      ...(apiKey !== undefined ? { apiKey } : {}),
    }
  }

  return services
}

function resolveServices(
  options: Record<string, unknown> | undefined,
  config: Config,
): Record<string, unknown> {
  const configProviders = getConfigProviders(config)
  const fromOptions = getServices(options)
  const fromPrefixedProviders = extractServicesFromPrefixedProviders(configProviders)

  const groupProvider = configProviders[GROUP_PROVIDER_ID]
  const fromGroupProvider = extractServicesFromGroupProvider(groupProvider)
  if (fromGroupProvider.used) {
    delete configProviders[GROUP_PROVIDER_ID]
  }

  return {
    ...fromOptions,
    ...fromPrefixedProviders,
    ...fromGroupProvider.services,
  }
}

function buildProviderConfig(input: {
  service: string
  baseURL: string
  apiKey: APIKeyResolution
  models: ModelMap
}): ProviderConfig {
  const options: Record<string, unknown> = {
    baseURL: input.baseURL,
  }

  if (input.apiKey.mode === "literal") {
    options.apiKey = input.apiKey.key
  }

  const provider: ProviderConfig = {
    npm: "@ai-sdk/openai",
    name: `Codex LB (${input.service})`,
    options,
    models: input.models,
  }

  if (input.apiKey.mode === "env") {
    provider.env = [input.apiKey.envName]
  }

  return provider
}

async function buildServiceProvider(
  client: PluginInput["client"],
  serviceKey: string,
  rawService: unknown,
  mirroredModels: ModelMap | null,
): Promise<ServiceBuildResult> {
  const normalizedService = validateServiceKey(serviceKey)
  if (!normalizedService) {
    await log(client, "warn", "Invalid service config", {
      service: serviceKey,
      reason: "Service key must match /^[a-z0-9][a-z0-9-]*$/",
    })
    return {
      status: "skip",
      service: serviceKey,
      reason: "invalid_service_key",
    }
  }

  if (!isRecord(rawService)) {
    await log(client, "warn", "Invalid service config", {
      service: normalizedService,
      reason: "Service value must be an object",
    })
    return {
      status: "skip",
      service: normalizedService,
      reason: "invalid_service_shape",
    }
  }

  const baseURL = normalizeBaseURL(rawService.baseURL)
  if (!baseURL) {
    await log(client, "warn", "Invalid service config", {
      service: normalizedService,
      reason: "baseURL must be a valid URL",
    })
    return {
      status: "skip",
      service: normalizedService,
      reason: "invalid_base_url",
    }
  }

  if (
    rawService.apiKey !== undefined &&
    rawService.apiKey !== null &&
    typeof rawService.apiKey !== "string"
  ) {
    await log(client, "warn", "Invalid service config", {
      service: normalizedService,
      reason: "apiKey must be a string when present",
    })
    return {
      status: "skip",
      service: normalizedService,
      reason: "invalid_api_key",
    }
  }

  const apiKey = resolveAPIKey(rawService.apiKey)
  if (apiKey.mode === "env" && !apiKey.key) {
    await log(client, "warn", "Missing env var for discovery", {
      service: normalizedService,
      env: apiKey.envName,
    })
  }

  const discoveryKey =
    apiKey.mode === "literal"
      ? apiKey.key
      : apiKey.mode === "env"
        ? apiKey.key
        : undefined

  let liveDiscovery: Awaited<ReturnType<typeof discoverLiveModels>> | null = null
  if (discoveryKey) {
    liveDiscovery = await discoverLiveModels(baseURL, discoveryKey)
    if (!liveDiscovery.ok) {
      if (liveDiscovery.reason === "invalid_payload") {
        await log(client, "warn", "Invalid /models payload", {
          service: normalizedService,
          baseURL,
          detail: liveDiscovery.detail,
        })
      } else {
        await log(client, "warn", "Failed /models fetch", {
          service: normalizedService,
          baseURL,
          detail: liveDiscovery.detail,
        })
      }
    }
  }

  const hasMirror = mirroredModels !== null
  const liveIDs = liveDiscovery && liveDiscovery.ok ? liveDiscovery.ids : null
  const hasLive = liveIDs !== null

  if (!hasMirror && !hasLive) {
    await log(client, "warn", "Skipping service without model catalog", {
      service: normalizedService,
      reason: "Both models.dev mirroring and live /models discovery unavailable",
    })
    return {
      status: "skip",
      service: normalizedService,
      reason: "no_catalog_data",
    }
  }

  let finalModels: ModelMap

  if (liveIDs) {
    if (hasMirror && mirroredModels) {
      finalModels = {}
      for (const modelID of liveIDs) {
        if (mirroredModels[modelID]) {
          finalModels[modelID] = cloneValue(mirroredModels[modelID])
          continue
        }
        finalModels[modelID] = { name: modelID }
      }
    } else {
      finalModels = {}
      for (const modelID of liveIDs) {
        finalModels[modelID] = { name: modelID }
      }
    }
  } else if (mirroredModels) {
    finalModels = cloneModelMap(mirroredModels)
  } else {
    finalModels = {}
  }

  const providerID = buildProviderID(normalizedService)
  const provider = buildProviderConfig({
    service: normalizedService,
    baseURL,
    apiKey,
    models: finalModels,
  })

  return {
    status: "ok",
    providerID,
    provider,
  }
}

export async function buildProviders(
  input: PluginInput,
  options?: Record<string, unknown>,
  config?: Config,
): Promise<Record<string, ProviderConfig>> {
  const services = config ? resolveServices(options, config) : getServices(options)
  if (Object.keys(services).length === 0) {
    await log(input.client, "warn", "Invalid service config", {
      reason: "No services configured",
    })
    return {}
  }

  const mirroredModels = await fetchMirroredModels(input.client)
  const serviceEntries = Object.entries(services)

  const settled = await Promise.allSettled(
    serviceEntries.map(([serviceKey, serviceConfig]) =>
      buildServiceProvider(input.client, serviceKey, serviceConfig, mirroredModels),
    ),
  )

  const providerMap: Record<string, ProviderConfig> = {}

  for (const result of settled) {
    if (result.status === "rejected") {
      await log(input.client, "warn", "Service provider build failed", {
        detail: result.reason instanceof Error ? result.reason.message : String(result.reason),
      })
      continue
    }

    if (result.value.status === "skip") {
      continue
    }

    providerMap[result.value.providerID] = result.value.provider
  }

  return providerMap
}

export function injectProviders(
  config: Config,
  providers: Record<string, ProviderConfig>,
  client: PluginInput["client"],
): Promise<void>[] {
  if (!isRecord(config.provider)) {
    config.provider = {}
  }

  const providerConfig = config.provider as Record<string, unknown>
  const logTasks: Promise<void>[] = []

  for (const [providerID, providerValue] of Object.entries(providers)) {
    const existingProvider = providerConfig[providerID]
    if (existingProvider !== undefined) {
      logTasks.push(
        log(client, "warn", "Provider ID already exists and will be overwritten", {
          provider: providerID,
        }),
      )

      if (isRecord(existingProvider)) {
        const existingOptions = isRecord(existingProvider.options) ? existingProvider.options : {}
        const mergedProvider: Record<string, unknown> = {
          ...existingProvider,
          npm: providerValue.npm,
          options: {
            ...existingOptions,
            ...providerValue.options,
          },
          models: providerValue.models,
        }

        if (providerValue.env) {
          mergedProvider.env = providerValue.env
        }

        if (typeof existingProvider.name !== "string" || existingProvider.name.trim() === "") {
          mergedProvider.name = providerValue.name
        }

        providerConfig[providerID] = mergedProvider
        continue
      }
    }

    providerConfig[providerID] = providerValue
  }

  return logTasks
}
