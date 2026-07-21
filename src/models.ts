import { readFile, readdir, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  MODEL_FIELDS,
  MODELS_DEV_URL,
  OPENAI_PROVIDER_ID,
  type AppClient,
  type ModelConfig,
  type ModelMap,
} from "./types.js"
import { fetchJSON } from "./discovery.js"
import { log } from "./logger.js"
import { cloneValue, isRecord } from "./utils.js"

function getOpencodeCacheDir(): string {
  const xdg = process.env.XDG_CACHE_HOME?.trim()
  if (xdg) {
    return path.join(xdg, "opencode")
  }

  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Caches", "opencode")
  }

  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA?.trim() || process.env.APPDATA?.trim()
    if (localAppData) {
      return path.join(localAppData, "opencode")
    }
  }

  return path.join(os.homedir(), ".cache", "opencode")
}

function uniquePaths(items: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const item of items) {
    if (seen.has(item)) {
      continue
    }
    seen.add(item)
    result.push(item)
  }

  return result
}

async function listCacheCandidates(): Promise<string[]> {
  const cacheDir = getOpencodeCacheDir()
  const explicit = process.env.OPENCODE_MODELS_PATH?.trim()
  const candidates: string[] = []

  if (explicit) {
    candidates.push(explicit)
  }

  candidates.push(path.join(cacheDir, "models.json"))

  const files = await readdir(cacheDir, { withFileTypes: true }).catch(() => [])
  const dynamic = await Promise.all(
    files
      .filter((entry) => entry.isFile() && /^models(?:-[^.]+)?\.json$/.test(entry.name))
      .map(async (entry) => {
        const absolutePath = path.join(cacheDir, entry.name)
        const mtimeMs = await stat(absolutePath)
          .then((info) => info.mtimeMs)
          .catch(() => 0)
        return { absolutePath, mtimeMs }
      }),
  )

  dynamic.sort((a, b) => b.mtimeMs - a.mtimeMs)
  candidates.push(...dynamic.map((item) => item.absolutePath))

  return uniquePaths(candidates)
}

async function loadJSON(filePath: string): Promise<unknown | null> {
  const text = await readFile(filePath, "utf8").catch(() => null)
  if (!text) {
    return null
  }

  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

async function loadMirroredModelsFromCache(client: AppClient): Promise<ModelMap | null> {
  const candidates = await listCacheCandidates()

  for (const filePath of candidates) {
    const catalog = await loadJSON(filePath)
    if (!catalog) {
      continue
    }

    const mirrored = buildMirroredOpenAIModels(catalog)
    if (!mirrored) {
      continue
    }

    await log(client, "debug", "Using cached models catalog", {
      path: filePath,
    })
    return mirrored
  }

  return null
}

export function mirrorModel(modelID: string, raw: unknown): ModelConfig {
  const mirrored: ModelConfig = { name: modelID }

  if (!isRecord(raw)) {
    return mirrored
  }

  if (typeof raw.name === "string" && raw.name.trim().length > 0) {
    mirrored.name = raw.name
  }

  for (const key of MODEL_FIELDS) {
    if (raw[key] !== undefined) {
      mirrored[key] = cloneValue(raw[key])
    }
  }

  if (
    Array.isArray(raw.reasoning_options) &&
    raw.reasoning_options.some(
      (option) =>
        isRecord(option) &&
        option.type === "effort" &&
        Array.isArray(option.values) &&
        option.values.includes("max"),
    )
  ) {
    mirrored.variants = {
      max: {
        reasoningEffort: "max",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      },
    }
  }

  if (isRecord(raw.provider) && typeof raw.provider.npm === "string") {
    mirrored.provider = {
      npm: raw.provider.npm,
    }
  }

  return mirrored
}

export function buildMirroredOpenAIModels(catalog: unknown): ModelMap | null {
  if (!isRecord(catalog)) {
    return null
  }

  const openAIProvider = catalog[OPENAI_PROVIDER_ID]
  if (!isRecord(openAIProvider)) {
    return null
  }

  const openAIModels = openAIProvider.models
  if (!isRecord(openAIModels)) {
    return {}
  }

  const mirrored: ModelMap = {}
  for (const [modelID, modelData] of Object.entries(openAIModels)) {
    mirrored[modelID] = mirrorModel(modelID, modelData)
  }

  return mirrored
}

export function cloneModelMap(source: ModelMap): ModelMap {
  const copy: ModelMap = {}
  for (const [modelID, modelConfig] of Object.entries(source)) {
    copy[modelID] = cloneValue(modelConfig)
  }
  return copy
}

export async function fetchMirroredModels(client: AppClient): Promise<ModelMap | null> {
  const cached = await loadMirroredModelsFromCache(client)
  if (cached) {
    return cached
  }

  let catalog: unknown

  try {
    catalog = await fetchJSON(MODELS_DEV_URL, { method: "GET" }, 20_000)
  } catch (error) {
    await log(client, "warn", "Failed models.dev catalog fetch", {
      url: MODELS_DEV_URL,
      detail: error instanceof Error ? error.message : String(error),
    })
    return null
  }

  const mirrored = buildMirroredOpenAIModels(catalog)
  if (!mirrored) {
    await log(client, "warn", "Missing openai entry from models.dev", {
      provider: OPENAI_PROVIDER_ID,
    })
    return null
  }

  return mirrored
}
