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

test("emits max variant only when models.dev advertises max effort", () => {
  const withMax = mirrorModel("gpt-5.6", {
    reasoning_options: [{ type: "effort", values: ["high", "max"] }],
  })
  const withoutMax = mirrorModel("gpt-5.5", {
    reasoning_options: [{ type: "effort", values: ["high", "xhigh"] }],
  })

  expect(withMax.variants).toEqual({
    max: {
      reasoningEffort: "max",
      reasoningSummary: "auto",
      include: ["reasoning.encrypted_content"],
    },
  })
  expect(withoutMax.variants).toBeUndefined()
})
