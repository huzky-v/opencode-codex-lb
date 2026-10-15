import { SERVICE_PROVIDER_PREFIX } from "./types.js"

export type ModelLike = {
  id: string
  providerID: string
  cost?: readonly {
    output: number
  }[]
}

export function isCodexLBProviderID(providerID: string): boolean {
  return providerID.startsWith(`${SERVICE_PROVIDER_PREFIX}-`)
}

export function pickLowestOutputCostModel<T extends ModelLike>(
  models: Iterable<T>,
): T | undefined {
  let cheapest: T | undefined
  let cheapestOutput = Infinity

  for (const model of models) {
    const output = model.cost?.[0]?.output
    if (typeof output !== "number" || !Number.isFinite(output) || output <= 0) continue
    if (
      output < cheapestOutput ||
      (output === cheapestOutput && model.id.localeCompare(cheapest?.id ?? "") < 0)
    ) {
      cheapest = model
      cheapestOutput = output
    }
  }

  return cheapest
}
