# Changelog

All notable changes to `@huzky-v/opencode-codex-lb` are documented here.

## [0.2.7] - 2026-11-23

### Added

- Added the `showUsageSidebar` option. Set it to `false` to hide the Codex LB usage panel and stop usage polling; it remains visible by default when usage is available.

### Changed

- Prompts now use the Responses API (SSE) by default. Set the plugin option `promptMode` to `"completion"` to retain Chat Completions streaming.

## [0.2.6] - 2026-10-23

### Added

- Generate reasoning variants for every effort advertised by `models.dev`.

### Changed

- Update the OpenCode V2 plugin and OpenTUI integrations, and declare the minimum Node.js and Bun runtimes.

## [0.2.5] - 2026-10-15

### Changed

- Ported the server and CLI integrations to the OpenCode v2 plugin SDK. This release no longer implements the V1 plugin API.
- Replaced legacy provider configuration injection with V2 provider and model transforms.

## [0.2.4] - 2026-07-21

### Added

- Added support for preserving model reasoning options and exposing a `max` reasoning variant when advertised by `models.dev`.

## [0.2.3] - 2026-07-18

### Added

- Added `small_model` hook: automatically picks the lowest output-cost model for title generation.

### Changed

- Improved pooled usage bar styling with elevated bar characters and dynamic width.

## [0.2.0] - 2026-07-17

### Added

- Added the pooled Codex LB usage sidebar for the OpenCode TUI.
- Added usage API capability detection and pooled usage fetching.
- Added `./server` and `./tui` package exports.
- Added one-command installation and TUI usage documentation.
- Added usage client and package manifest tests.

## [0.1.0] - 2026-04-26

### Added

- Added the OpenCode plugin for configuring multiple Codex LB services.
- Added service-based OpenAI-compatible provider generation.
- Added literal and environment-referenced API key support.
- Added model catalog loading from the local OpenCode cache and `models.dev`.
- Added optional live model discovery from configured services.
- Added validation, provider merging, and resilient external request handling.
