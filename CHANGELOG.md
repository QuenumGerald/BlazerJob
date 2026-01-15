# Changelog

All notable changes to this project will be documented in this file.

## [1.3.0] - 2026-01-15
### Added
- **Configurable retry strategies**: Choose between `exponential` (default), `linear`, or `fixed` backoff strategies
- **Retry configuration**: Set custom `delayMs` (base delay) and `maxDelayMs` (maximum delay cap) for retry attempts
- **Webhook notifications on retry**: Webhooks are now called on each retry attempt with detailed information (attemptNumber, retriesLeft, nextRetryAt)
- **Enhanced webhook payloads**: Improved webhook payloads for both retry and final failure events
### Improved
- Better retry error tracking with enhanced logging showing retry strategy in use
- More granular control over retry behavior per task
### Types
- Added `RetryStrategy` type: `'exponential' | 'linear' | 'fixed'`
- Added `RetryConfig` interface with `strategy`, `delayMs`, and `maxDelayMs` options
- Extended `ScheduleExtra` interface to include optional `retryConfig`

## [1.2.0] - 2026-01-11
### Performance
- Enabled SQLite WAL by default to improve concurrent reads/writes.
- Added configurable `concurrency` (default 1 for backward compatibility).
- Reduced scheduler tick interval to 50 ms with immediate drain when capacity is reached.
- Bench (synthetic, local NVMe) : up to ~4.4k tasks/s (concurrency 1024, tasks 10 ms).
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
- First public version, core features for scheduling and managing async tasks with SQLite backend.

