# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Named message interfaces: `SystemMessage`, `UserMessage`, `AssistantMessage`, `ToolMessage`, `HistoryMessage`
- Image capability: `AgentInfo.capabilities.image` (`http`, `data`)
- `listAllSessions()` helper that auto-paginates all session IDs

### Removed

- `writeSSEEvents` and `SSEStreamingApi` are no longer exported from the public API

### Changed

- `authenticate` option now receives the Hono `Context` as a second argument, enabling per-route auth logic (e.g. allowing unauthenticated `GET /meta`)
- `authenticate` is now applied to all routes including `GET /meta`
- `ContentBlock` image variant: replaced `{ mimeType, data }` with `{ url }` (supports `https://` and `data:` URIs)
- `ServerToolRef.trust` is now optional (defaults to `false`)
- `SessionListResponse.nextCursor` renamed to `next`
- `SessionTurnRequest.messages` narrowed to `(UserMessage | ToolMessage | ToolPermissionMessage)[]`
- `SessionResponse.tools` is now optional
- Simplified type exports with `export type *`
- Removed `limit` param from `listSessions()`

## [0.1.0] - 2026-03-26

### Added

- Initial release of the TypeScript SDK for the Agent Application Protocol (AAP)

[unreleased]: https://github.com/agentapplicationprotocol/typescript-sdk/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/agentapplicationprotocol/typescript-sdk/releases/tag/v0.1.0
