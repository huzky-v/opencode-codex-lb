# opencode-codex-lb
An OpenCode plugin for codex-lb users to manage multiple API keys and endpoints.

## Features
- Simplified setup for codex-lb users
- Multiple API keys setup
- Models setting is in sync with `models.dev`, no additional model setting is required for provider
- Automatic small model selection (cheapest by output cost) for title generation
- Pooled usage display on the sidebar with compact, styled progress bars

## Installation

One-command server and TUI installation requires v0.2.0 or later. Install both
plugins globally with:

```bash
opencode plugin @huzky-v/opencode-codex-lb@latest --global --force
```

Quit and restart OpenCode after installation.

## Service Configuration

Service URLs and API-key environment references are user-specific and remain in
`<config-dir>/opencode.json` (normally `~/.config/opencode/opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@huzky-v/opencode-codex-lb"],
  "provider": {
    "codex-lb": {
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
  }
}
```

Reference models as `codex-lb-${service}/model-name`, for example
`codex-lb-free/gpt-5.4-mini`.
