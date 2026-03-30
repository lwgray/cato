# Changelog

All notable changes to Cato will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**Version Alignment:** Cato MAJOR.MINOR versions track compatible Marcus versions.
Cato PATCH versions are independent dashboard-only updates.

## [Unreleased]
### Added
### Changed
### Deprecated
### Removed
### Fixed
### Security

## [0.2.1] - 2026-03-29
### Added
- Pre-commit hooks: mypy, black, isort, flake8, pydocstyle, bandit, detect-secrets
- GitHub Actions CI/CD workflows: quality checks, test suite, Claude code review, version gate
- Configuration files: `.flake8`, `.coveragerc`, `pytest.ini`, `.secrets.baseline`
- Expanded dev dependencies (pytest-asyncio, pytest-cov, isort, flake8, bandit, httpx)
- Custom pre-commit hooks for naive datetime detection and changelog reminders

### Fixed
- All existing lint, type annotation, and formatting issues across the codebase
- Setuptools flat-layout package discovery error in CI
- Deprecated license format in pyproject.toml
- Historical API integration tests now skip gracefully when Marcus is not installed

## [0.1.1] - 2026-03-09
### Added
- Decisions/artifacts support in aggregator
- Data export functionality for multi-agent analysis
- Project filtering with efficient fuzzy matching
- Background refresh for projects

### Fixed
- JSON fallback and view-mode filtering for decisions/artifacts
- Duplicate client-side project filtering
- Network view filtering by selected project
- Progress tracking and analysis caching issues
- Power scale exponent set to 1.0 for linear timeline consistency

### Changed
- Removed historical analysis UI, keeping only live mode
- Removed mock mode, switched to live-only data
- Optimized /api/projects to load tasks once instead of per-project

## [0.1.0] - 2026-03-01
### Added
- Initial release of Cato visualization dashboard
- Network graph for task dependency visualization
- Agent swim lanes timeline view
- Conversation view for agent message flow
- Real-time metrics panel
- Timeline playback functionality
- Project filtering
- Auto-refresh with configurable intervals
- FastAPI backend serving Marcus data
- React + TypeScript frontend
- Zustand state management
- Docker integration with Marcus

[Unreleased]: https://github.com/lwgray/cato/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/lwgray/cato/compare/v0.2.0...v0.2.1
[0.1.1]: https://github.com/lwgray/cato/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/lwgray/cato/releases/tag/v0.1.0
