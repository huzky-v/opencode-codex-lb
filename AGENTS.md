# AGENTS.md

## Purpose

This repository ships `opencode-codex-lb`, an OpenCode plugin module that builds one provider per configured service and injects them into runtime config.

## Architecture

- `src/index.ts`: plugin entrypoint, lazy provider preparation, config injection.
- `src/providers.ts`: service extraction, validation, provider construction, and merge behavior.
- `src/models.ts`: models.dev mirroring and local cache loading.
- `src/discovery.ts`: timeout-safe JSON fetch and live `/models` discovery.
- `src/options.ts`: service and API key normalization/parsing.
- `src/logger.ts`: resilient client logging wrapper.
- `src/utils.ts`: shared helpers (`isRecord`, deep clone fallback).

## Key Behaviors

- Service IDs must match `^[a-z0-9][a-z0-9-]*$`.
- Provider IDs are generated as `codex-lb-<service>`.
- API keys support literal values and env references using `{env:VAR_NAME}`.
- Model catalog data comes from (in order): local OpenCode cache, `https://models.dev/api.json`, then optional live `/models` filtering when an API key is available.
- Existing provider entries with matching IDs are merged and overwritten where needed.

## Local Development

- Install: `npm install`
- Build: `npm run build`
- Publish: `npm run publish:npm`

## Contribution Notes

- Keep runtime behavior non-fatal when external discovery endpoints fail.
- Prefer small, focused modules and strict typing.
- Preserve backwards compatibility for config shapes:
  - plugin options: `services`
  - grouped provider: `provider.codex-lb.options.services`
  - prefixed providers: `provider.codex-lb-<service>`
