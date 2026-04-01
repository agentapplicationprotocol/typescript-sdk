# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- `GET /session/:id` now accepts a `?history=compacted` or `?history=full` query parameter to request history in the response; omitting it returns no history
- `Handler.getSession(sessionId, history?)` receives the parsed history mode
- `Client.getSession(sessionId, history?)` appends the query parameter when provided

## [0.4.0] - 2026-04-01

### Added

- Named variant types for `ContentBlock`: `TextContentBlock`, `ThinkingContentBlock`, `ToolUseContentBlock`, `ImageContentBlock`
- Named variant types for `AgentOption`: `TextAgentOption`, `SecretAgentOption`, `SelectAgentOption`
- Named variant types for `SSEEvent`: `SessionStartEvent`, `TurnStartEvent`, `TextDeltaEvent`, `ThinkingDeltaEvent`, `TextEvent`, `ThinkingEvent`, `ToolCallSSEEvent`, `ToolResultEvent`, `TurnStopEvent`
- `DeltaSSEEvent` union type for `stream: "delta"` events
- `MessageSSEEvent` union type for `stream: "message"` events
- `AiModelProvider` in `@agentapplicationprotocol/server` — a `ModelProvider` implementation backed by any Vercel AI SDK `LanguageModel`
- `Session` class in `@agentapplicationprotocol/client` — stateful client-side session with history accumulation, pending tool use resolution, and automatic deduplication of unchanged `tools`/`agent` overrides on `send()`
- `PendingToolUse` type in `@agentapplicationprotocol/client` — returned by `Session.create()` and `Session.send()` to classify unresolved tool calls into `client` and `server` buckets
- CLI example in `@agentapplicationprotocol/client` with `/stream`, `/enable`, `/disable`, `/trust`, `/set` commands and a built-in `calculate` client tool

### Changed

- **BREAKING**: Restructured as a pnpm monorepo with four packages:
  - `@agentapplicationprotocol/core` — shared types and utilities (`types.ts`, `utils.ts`)
  - `@agentapplicationprotocol/client` — AAP client
  - `@agentapplicationprotocol/server` — AAP server, `Session`/`Agent`/`ModelProvider` base classes, and AI SDK example
  - `@agentapplicationprotocol/sdk` — re-export umbrella (drop-in replacement for the old single package)
- **BREAKING**: `@agentapplicationprotocol/sdk` now re-exports `client` and `server` as namespaces instead of flat exports to resolve the `Session` name conflict. Use `client.Session` and `server.Session` instead of `Session`.
- `ServerHandler.getMeta()` is now synchronous (`MetaResponse` instead of `Promise<MetaResponse>`)
- **BREAKING**: `Server` class replaced by `aap(handler)` — returns a `Hono` app to compose with `app.route('/', aap(handler))`. Auth, CORS, and base path are handled by the outer app.
- **BREAKING**: `ServerHandler` renamed to `Handler`.

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

[unreleased]: https://github.com/agentapplicationprotocol/typescript-sdk/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/agentapplicationprotocol/typescript-sdk/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/agentapplicationprotocol/typescript-sdk/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/agentapplicationprotocol/typescript-sdk/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/agentapplicationprotocol/typescript-sdk/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/agentapplicationprotocol/typescript-sdk/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/agentapplicationprotocol/typescript-sdk/releases/tag/v0.1.0
