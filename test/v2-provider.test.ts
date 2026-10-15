import { expect, test } from "bun:test"
import { toOpenCodeModelInfo } from "../src/providers"

test("converts a mirrored model into a V2 provider source model", () => {
  const model = toOpenCodeModelInfo("codex-lb-paid", "gpt-5", {
    name: "GPT-5",
    family: "gpt-5",
    release_date: "2026-03-01",
    tool_call: false,
    modalities: { input: ["text", "image"], output: ["text"] },
    cost: { input: 1, output: 5, cache_read: 0.1, cache_write: 0.2 },
    limit: { context: 128_000, output: 16_000 },
    variants: { max: { reasoningEffort: "max" } },
  })

  expect(model).toMatchObject({
    id: "gpt-5",
    providerID: "codex-lb-paid",
    name: "GPT-5",
    family: "gpt-5",
    capabilities: { tools: false, input: ["text", "image"], output: ["text"] },
    cost: [{ input: 1, output: 5, cache: { read: 0.1, write: 0.2 } }],
    limit: { context: 128_000, output: 16_000 },
    variants: [{ id: "max", settings: { reasoningEffort: "max" } }],
  })
  expect(model.time.released).toBe(Date.parse("2026-03-01"))
})

test("keeps valid defaults when a live model has no catalog metadata", () => {
  const model = toOpenCodeModelInfo("codex-lb-free", "unlisted-model", { name: "unlisted-model" })
  expect(model).toMatchObject({
    id: "unlisted-model",
    providerID: "codex-lb-free",
    capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
    cost: [],
    enabled: true,
  })
  expect(model.limit.context).toBeGreaterThan(0)
  expect(model.limit.output).toBeGreaterThan(0)
})
