# Changelog

All notable changes to this project will be documented in this file.

## [1.0.2] - 2025-05-24
### Added
- Added support for Cosmos SDK queries (balance, transactions)
- Added HTTP request task scheduling capabilities
- Added autoExit option for script/test environments
### Performance
- Enabled SQLite WAL by default for better concurrent reads/writes
- Added configurable `concurrency` (default 1 for backward compatibility)
- Reduced scheduler tick interval to 50 ms with immediate drain when capacity is reached
- Bench (tâches factices, NVMe local) : jusqu’à ~4.4k tasks/s (concurrency 1024, tâches 10 ms)

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

