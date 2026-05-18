# Changelog

All notable changes to `routy-edge` are documented here. The project follows
[Semantic Versioning](https://semver.org/) and the changelog format from
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

The wire contract version (`pr=v1`) is independent of the package version —
see [CONTRACT.md §10](./CONTRACT.md#10-stability-guarantees) for contract
stability guarantees.

## [Unreleased]

### Added
- Initial Node + TypeScript scaffold: Fastify, pg, pino, prom-client, nanoid.
- `pr=v1` happy path, transport-error fallback, queued-click replay worker.
- HEAD/OPTIONS short-circuit (no upstream call for link previewers).
- Cloaked HTML render with attribute escaping.
- Multi-domain support via Caddy + on-demand TLS.
- `/_health` and `/_metrics` endpoints.
- Smoke tests for render, cloaked, and config parsing.
- GitHub Actions CI (typecheck, test, build, Dockerfile build).
- GitHub Actions release workflow (multi-arch Docker Hub publish on tag push).
