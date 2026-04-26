import type { Plugin, PluginModule, PluginOptions } from "@opencode-ai/plugin"
import { buildProviders, injectProviders } from "./providers.js"
import { SERVICE, type CodexLBOptions, type ProviderConfig } from "./types.js"

export const CodexLB: Plugin = async (
  input,
  rawOptions?: PluginOptions,
) => {
  const options = (rawOptions ?? {}) as CodexLBOptions
  let preparedProviders: Record<string, ProviderConfig> | null = null
  let preparingProviders: Promise<Record<string, ProviderConfig>> | null = null

  return {
    config: async (config) => {
      if (!preparedProviders) {
        preparingProviders ??= buildProviders(input, options, config)
        preparedProviders = await preparingProviders
      }

      const pendingLogs = injectProviders(config, preparedProviders, input.client)
      if (pendingLogs.length > 0) {
        await Promise.allSettled(pendingLogs)
      }
    },
  }
}

const pluginModule: PluginModule = {
  id: SERVICE,
  server: CodexLB,
}

export default pluginModule
