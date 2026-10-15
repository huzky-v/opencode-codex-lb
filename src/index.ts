import { Plugin } from "@opencode/plugin"
import { buildProviders } from "./providers.js"
import { isCodexLBProviderID, pickLowestOutputCostModel } from "./small_model.js"
import { SERVICE, type CodexLBOptions } from "./types.js"
import { log } from "./logger.js"
import { isRecord } from "./utils.js"

function textContent(value: unknown): string {
  if (typeof value === "string") return value
  if (Array.isArray(value)) {
    return value.map((part) => textContent(part)).filter(Boolean).join("\n")
  }
  if (!isRecord(value)) return ""
  if (typeof value.text === "string") return value.text
  if (value.content !== undefined) return textContent(value.content)
  return ""
}

function buildTitlePrompt(system: unknown[], messages: unknown[]): string {
  const systemText = system.map(textContent).filter(Boolean)
  const conversation = messages.flatMap((message) => {
    if (!isRecord(message)) return []
    const content = textContent(message.content)
    if (!content) return []
    const role = typeof message.role === "string" ? message.role : "message"
    return [`${role}: ${content}`]
  })
  return [...systemText, ...conversation].join("\n\n")
}

export default Plugin.define({
  id: SERVICE,
  async setup(ctx) {
    const configured = await ctx.provider.list()
    const providers = await buildProviders(ctx.options as CodexLBOptions, configured.data)

    await ctx.provider.transform((editor) => {
      for (const built of providers) {
        const existing = editor.get(built.providerID)
        if (!existing) {
          editor.add({ info: built.info, models: built.models })
          continue
        }

        void log("warn", "Provider ID already exists and will be overwritten", {
          provider: built.providerID,
        })
        editor.update(built.providerID, (provider) => {
          if (!provider.name.trim()) provider.name = built.info.name
          provider.activation = "enabled"
          provider.package = built.info.package
          provider.settings = { ...provider.settings, ...built.info.settings }
        })
        editor.models.set(built.providerID, built.models)
      }
    })

    await ctx.session.hook("title", async (event) => {
      if (!isCodexLBProviderID(event.model.providerID)) return
      const provider = providers.find((item) => item.providerID === event.model.providerID)
      const cheapest = provider ? pickLowestOutputCostModel(provider.models) : undefined
      if (!cheapest) return

      try {
        const generated = await ctx.generate.text({
          model: { providerID: cheapest.providerID, id: cheapest.id },
          prompt: buildTitlePrompt(event.system, event.messages),
        })
        const title = generated.text.trim()
        if (title) event.result = title
      } catch (error) {
        await log("warn", "Small-model title generation failed", {
          detail: error instanceof Error ? error.message : String(error),
        })
      }
    })
  },
})
