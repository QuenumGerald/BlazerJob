# Changelog

All notable changes to this project will be documented in this file.

## [2.1.0] - 2026-10-02
### Added
- Named handlers with JSON payloads for restart-safe custom tasks.
- Explicit `blocked` status when a handler is missing (never a fake success).
- Lease-based reclaim of interrupted `running` tasks (at-least-once delivery).
- Typed results via `waitFor`, `getTask`, `getTaskResult`, and `on('task')`.
- HTTP results: status, filtered headers, JSON/text/empty bodies.
- Configurable retries (backoff, jitter, policy), `Retry-After`, `timeoutMs` vs `maxDurationMs`, `AbortSignal`.
- `cancel()`, async `shutdown()`, process-local `rate` limits.
- SQLite migrations for resume metadata and stored results.
### Changed
- Native HTTP tasks must be scheduled without a custom function.
- No implicit encryption key; encrypt only with an explicit key.
- Library import no longer installs SIGINT/SIGTERM or calls `process.exit()`.
- `autoExit` no longer exits the process.
- Default HTTP method is GET when omitted.
- Management server redacts secrets and does not accept anonymous functions.
### Fixed
- Persisted anonymous tasks no longer complete as success without running.
- `running` tasks after restart are reclaimed via leases, not left stuck or blindly reset.
- Webhooks are actually delivered.
- Observer/callback exceptions cannot retry a successful task.

## [1.4.0] - 2026-04-01
### Added
- Added shell task handler support for system command execution.
- Added support for optional `taskFn` in `schedule()` allowing native task handlers to execute.
### Fixed
- Fixed `taskCount` tracking for accurate `autoExit` and `onAllTasksEnded` callbacks.
- Fixed `maxRuns` and `maxDurationMs` limits that were previously ignored.
- Fixed `scheduleManyCosmosQueries` and other batch schedulers to allow native execution without dummy functions.
- Fixed unused `shouldTerminate` local variable in scheduler tick.

## [1.3.1] - 2026-01-30
### Maintenance
- Version bump to 1.3.1 for release.

## [1.2.0] - 2026-01-11
### Performance
- Enabled SQLite WAL by default to improve concurrent reads/writes.
- Added configurable `concurrency` (default 1 for backward compatibility).
- Reduced scheduler tick interval to 50 ms with immediate drain when capacity is reached.
- Bench (synthetic, local NVMe): up to ~4.4k tasks/s (concurrency 1024, tasks 10 ms).
### Docs
- Updated README “Performance & tuning” section with concurrency/WAL details and benchmark table.
- Clarified defaults and examples with concurrency option.

## [1.0.2] - 2025-05-24
### Added
- Added support for Cosmos SDK queries (balance, transactions)
- Added HTTP request task scheduling capabilities
- Added autoExit option for script/test environments
### Improved
- Translated all French documentation to English
- Enhanced error handling for task scheduling
- Improved TypeScript type definitions

## [1.0.1] - 2025-05-20
### Fixed
- Corrected project name from 'BlazeJob' to 'BlazerJob' throughout the documentation
- Updated README with better feature highlights and usage examples

## [1.0.0] - Initial release
- First public version, core features for scheduling and managing SQLite-backed tasks.
