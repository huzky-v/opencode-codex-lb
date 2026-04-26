# opencode-codex-lb
An OpenCode plugin for codex-lb users to manage multiple API keys and endpoints.

## Features
- Simplified setup for codex-lb users
- Multiple API keys setup
- Models setting is in sync with `models.dev`, no additional model setting is required for provider

## Configuration
Include `@huzky-v/opencode-codex-lb` in `opencode.json`.
```
  "plugin": [
    "@huzky-v/opencode-codex-lb"
  ],
```

To configure `codex-lb` provider in Opencode, please set the provider in `opencode.json`,
```
  "provider": {
    "codex-lb": {
      "options": {
        "services": {
          "paid": {
            "baseURL": "https://codex-lb.example.com//v1",
            "apiKey": "{env:CODEX_KEY_PAID}"
          },
          "free": {
            "baseURL": "https://codex-lb.example.com/v1",
            "apiKey": "{env:CODEX_KEY_FREE}"
          },
          other codex-lb provider...
        }
      }
    }
  },
```

To make reference of the model, please use the following: 
`codex-lb-${key_name}/model-name`, for example: `codex-lb-free/gpt-5.4-mini`