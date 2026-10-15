import { describe, expect, test } from "bun:test"
import {
  isCodexLBProviderID,
  pickLowestOutputCostModel,
  type ModelLike,
} from "../src/small_model"

function model(id: string, output: number, providerID = "codex-lb-free"): ModelLike {
  return { id, providerID, cost: [{ output }] }
}

describe("isCodexLBProviderID", () => {
  test("matches codex-lb- prefixed provider ids", () => {
    expect(isCodexLBProviderID("codex-lb-free")).toBe(true)
    expect(isCodexLBProviderID("codex-lb-paid")).toBe(true)
    expect(isCodexLBProviderID("codex-lb-")).toBe(true)
  })

  test("rejects other provider ids including the bare prefix", () => {
    expect(isCodexLBProviderID("codex-lb")).toBe(false)
    expect(isCodexLBProviderID("openai")).toBe(false)
    expect(isCodexLBProviderID("anthropic")).toBe(false)
    expect(isCodexLBProviderID("")).toBe(false)
  })
})

describe("pickLowestOutputCostModel", () => {
  test("returns undefined for an empty model list", () => {
    expect(pickLowestOutputCostModel([])).toBeUndefined()
  })

  test("selects the single cheapest model by output cost", () => {
    const models = [
      model("gpt-5", 10),
      model("gpt-5-mini", 1.5),
      model("gpt-5-nano", 0.4),
    ]
    expect(pickLowestOutputCostModel(models)?.id).toBe("gpt-5-nano")
  })

  test("ignores models with missing, zero, or non-finite cost", () => {
    const models = [
      { id: "free", providerID: "codex-lb-free" },
      model("zero", 0),
      { id: "nan", providerID: "codex-lb-free", cost: [{ output: NaN }] },
      { id: "infinity", providerID: "codex-lb-free", cost: [{ output: Infinity }] },
      model("priced", 3.25),
    ]
    expect(pickLowestOutputCostModel(models)?.id).toBe("priced")
  })

  test("returns undefined when every model lacks usable cost data", () => {
    const models = [
      { id: "free", providerID: "codex-lb-free" },
      model("zero", 0),
    ]
    expect(pickLowestOutputCostModel(models)).toBeUndefined()
  })

  test("breaks ties deterministically by model id", () => {
    const models = [model("zeta", 2), model("alpha", 2), model("mid", 5)]
    expect(pickLowestOutputCostModel(models)?.id).toBe("alpha")
  })

  test("does not mutate the input list", () => {
    const models = [model("a", 5), model("b", 1), model("c", 3)]
    pickLowestOutputCostModel(models)
    expect(models.map((item) => item.id)).toEqual(["a", "b", "c"])
  })

  test("preserves full model metadata on the returned object", () => {
    const priced = { ...model("gpt-5", 8), name: "GPT-5", family: "gpt-5" }
    expect(pickLowestOutputCostModel([priced])).toBe(priced)
  })
})
