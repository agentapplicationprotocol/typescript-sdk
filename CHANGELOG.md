# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- New `server_new.ts` module with `ModelProvider`, `Session`, and `Agent` base classes for building AAP-compatible agents
- `Session` stores `sessionId`, `agentConfig`, `clientTools`, and accumulated `history`
- `Session.toSessionResponse()` returns a `SessionResponse` from session state
- `Session.runNewSession(req: CreateSessionRequest)` runs the first turn and wraps the result with `sessionId`
- `Session.runTurn(req: SessionTurnRequest)` applies per-request overrides then dispatches by stream mode
- Vercel AI SDK example agent (`src/examples/ai-sdk/`) with `AiSDKSession`, `AiSDK` model provider, and `toAiMessages` converter
- `ModelProvider` and `Session` exported from the package root

## [0.3.1] - 2026-03-29

### Added

- Server `GET /session/:id` now redacts option values of type `"secret"` to `"***"` in the response

## [0.3.0] - 2026-03-29

### Changed

- **BREAKING**: `AgentResponse.sessionId` removed; `createSession` now returns `CreateSessionResponse` (extends `AgentResponse`) with `sessionId: string` required

## [0.2.1] - 2026-03-29

### Fixed

- Exclude test files from published package (`dist/**/*.test.js`, `dist/**/*.test.d.ts`)

## [0.2.0] - 2026-03-29

### Added

- Named message interfaces: `SystemMessage`, `UserMessage`, `AssistantMessage`, `ToolMessage`, `HistoryMessage`
- Image capability: `AgentInfo.capabilities.image` (`http`, `data`)
- `listAllSessions()` helper that auto-paginates all session IDs
- `createSession()` validates that the last message is a user message (client throws, server returns 400)
- `sseEventsToMessages(events)` utility to convert SSE event list to `HistoryMessage[]`
- `resolvePendingToolUse(messages, clientTools?)` utility to classify pending tool calls into client-side and server-side

### Fixed

- `ServerHandler.createSession` and `sendTurn` return types corrected to `Promise<AgentResponse | AsyncIterable<SSEEvent>>`

### Removed

- `writeSSEEvents` and `SSEStreamingApi` are no longer exported from the public API
- `Server.fetch` removed; use `server.app.fetch` directly

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

[unreleased]: https://github.com/agentapplicationprotocol/typescript-sdk/compare/v0.3.1...HEAD
[0.3.1]: https://github.com/agentapplicationprotocol/typescript-sdk/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/agentapplicationprotocol/typescript-sdk/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/agentapplicationprotocol/typescript-sdk/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/agentapplicationprotocol/typescript-sdk/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/agentapplicationprotocol/typescript-sdk/releases/tag/v0.1.0
