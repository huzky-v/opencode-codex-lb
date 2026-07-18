# Changelog

All notable changes to `@huzky-v/opencode-codex-lb` are documented here.

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
