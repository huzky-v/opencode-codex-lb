# opencode-codex-lb

An OpenCode v2 plugin for codex-lb users to manage multiple API keys and endpoints.

## Features

- Simplified setup for codex-lb users
- Multiple API keys and endpoints
- Model catalogs mirrored from `models.dev`, with optional live `/models` filtering
- Automatic lowest-output-cost model selection for title generation
- Pooled usage display in the CLI sidebar

## Installation

Add the package to the `plugins` array in your OpenCode v2 configuration (normally
`~/.config/opencode/opencode.json`):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "@huzky-v/opencode-codex-lb",
      "options": {
        "services": {
          "paid": {
            "baseURL": "https://codex-lb.example.com/v1",
            "apiKey": "{env:CODEX_KEY_PAID}"
          },
          "free": {
            "baseURL": "https://codex-lb.example.com/v1",
            "apiKey": "{env:CODEX_KEY_FREE}"
          }
        }
      }
    }
  ]
}
```

Restart OpenCode after editing the configuration. Environment references use
`{env:VAR_NAME}`; literal API keys are also supported.

If upgrading from V1, move `provider.codex-lb.options.services` (or
`providers.codex-lb.settings.services`) into the plugin's `options.services`
as shown above. V2 no longer loads a configuration-only `codex-lb` group
provider. Prefixed provider entries with valid V2 provider definitions remain
usable, but `options.services` is the recommended configuration.

## Models

Reference models as `codex-lb-${service}/model-name`, for example
`codex-lb-free/gpt-5.4-mini`.
