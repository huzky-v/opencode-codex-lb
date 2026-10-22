import { expect, test } from "bun:test"
import { mirrorModel } from "../src/models"

test("preserves reasoning options including max", () => {
  const reasoningOptions = [{ type: "effort", values: ["none", "high", "max"] }]

  const mirrored = mirrorModel("gpt-5.6", {
    name: "GPT-5.6",
    reasoning: true,
    reasoning_options: reasoningOptions,
  })

  expect(mirrored.reasoning_options).toEqual(reasoningOptions)
})

test("emits a variant for every advertised reasoning effort", () => {
  const allEfforts = ["none", "low", "medium", "high", "xhigh", "max"]
  const withAllEfforts = mirrorModel("gpt-6-sol", {
    reasoning_options: [{ type: "effort", values: allEfforts }],
  })
  const withoutMax = mirrorModel("gpt-5.5", {
    reasoning_options: [{ type: "effort", values: ["high", "xhigh"] }],
  })

  expect(Object.keys(withAllEfforts.variants as Record<string, unknown>)).toEqual(allEfforts)
  expect(withAllEfforts.variants).toEqual(
    Object.fromEntries(
      allEfforts.map((effort) => [
        effort,
        {
          reasoningEffort: effort,
          reasoningSummary: "auto",
          include: ["reasoning.encrypted_content"],
        },
      ]),
    ),
  )
  expect(withoutMax.variants).toEqual({
    high: {
      reasoningEffort: "high",
      reasoningSummary: "auto",
      include: ["reasoning.encrypted_content"],
    },
    xhigh: {
      reasoningEffort: "xhigh",
      reasoningSummary: "auto",
      include: ["reasoning.encrypted_content"],
    },
  })
})
