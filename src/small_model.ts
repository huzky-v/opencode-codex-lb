import { SERVICE_PROVIDER_PREFIX } from "./types.js"

export type ModelLike = {
  id: string
  providerID: string
  cost?: {
    output: number
  }
}

export function isCodexLBProviderID(providerID: string): boolean {
  return providerID.startsWith(`${SERVICE_PROVIDER_PREFIX}-`)
}

export function pickLowestOutputCostModel<T extends ModelLike>(
  models: Record<string, T>,
): T | undefined {
  const candidates = Object.values(models).filter((model) => {
    const output = model.cost?.output
    return typeof output === "number" && Number.isFinite(output) && output > 0
  })

  if (candidates.length === 0) {
    return undefined
  }

  candidates.sort((a, b) => {
    const diff = (a.cost?.output ?? Infinity) - (b.cost?.output ?? Infinity)
    if (diff !== 0) {
      return diff
    }
    return String(a.id).localeCompare(String(b.id))
  })

  return candidates[0]
}
