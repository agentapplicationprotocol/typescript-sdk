# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **core**: New `HistoryType = "compacted" | "full"` type; `GetSessionHistoryResponse.history` is now typed as `Partial<Record<HistoryType, HistoryMessage[]>>`
- **core**: New `ToolCallInput = Record<string, unknown>` type used in `ToolUseContentBlock.input` and `ToolCall.input`
- **core**: New `ToolCall` interface (plain tool call payload: `toolCallId`, `name`, `input`) — previously named `ToolCallEvent`
- **core**: New `ToolResult` interface (`toolCallId`, `content`) shared by `ToolMessage` and `ToolResultEvent`
- **core**: New `SessionInfo` interface — the session data shape used in `GetSessionResponse` and `GetSessionsResponse.sessions`
- **core**: New `AgentCapabilities` interface extracted from `AgentInfo.capabilities`

### Changed

- **core**: `AgentCapabilities.history` is now `Partial<Record<HistoryType, ...>>` and `AgentCapabilities.stream` is now `Partial<Record<StreamMode, ...>>`
- **core**: `ToolCallEvent` renamed to `ToolCall`; `ToolCallSSEEvent` renamed to `ToolCallEvent` (now extends `ToolCall`)
- **core**: `ToolCallResult` renamed to `ToolResult`
- **core**: Response types renamed to match endpoint conventions:
  - `MetaResponse` → `GetMetaResponse`
  - `AgentResponse` → `PostSessionTurnResponse`
  - `CreateSessionResponse` → `PostSessionsResponse`
  - `SessionResponse` → `GetSessionResponse` (type alias for `SessionInfo`)
  - `SessionHistoryResponse` → `GetSessionHistoryResponse`
  - `SessionListResponse` → `GetSessionsResponse`
- **core**: Request types renamed to match endpoint conventions:
  - `CreateSessionRequest` → `PostSessionsRequest`
  - `SessionTurnRequest` → `PostSessionTurnRequest`
- **server**: `Handler.getSession` now returns `GetSessionResponse | undefined` instead of throwing when session is not found
- **server**: `Handler.getSessionHistory` signature changed to `(sessionId: string, type) => Promise<HistoryMessage[] | undefined>` — returns `undefined` when session is not found; the router responds with 404 accordingly
- **server**: `Handler` methods renamed to match endpoint conventions: `listSessions` → `getSessions`, `createSession` → `postSessions`, `sendTurn` → `postSessionTurn`
- **client**: Client methods renamed to match: `listSessions` → `getSessions`, `createSession` → `postSessions`, `sendTurn` → `postSessionTurn`

## [0.7.3] - 2026-04-18

### Added

- **server**: Export `toAiToolSet` — converts `ToolSpec[]` to a Vercel AI SDK `ToolSet`

## [0.7.2] - 2026-04-18

### Added

- **server**: Export AI SDK conversion helpers — `toAiMessages`, `fromAiMessages`, `fromAiFinishReason`, `fromAiStreamPart`
- **server**: `fromAiMessages` now accepts `ModelMessage[]` (all roles) for symmetry with `toAiMessages`

## [0.7.1] - 2026-04-07

### Added

- TypeScript source files (`src/`) are now included in published packages alongside `dist/`, enabling IDE jump-to-definition to land on real `.ts` source via declaration maps

### Fixed

- **server**: Strip `$schema` field from `z.toJSONSchema()` output in tool `parameters`
- **server**: Prevent yielding premature `turn_stop` event during streaming — `runTurnDelta` now suppresses the `turn_stop` from `stream()` and emits its own final one
- **server**: Yield `turn_stop` with `stopReason: "error"` when `model.stream()` throws

## [0.7.0] - 2026-04-04

### Changed

- **BREAKING**: Protocol version bumped to `3`
- **BREAKING**: `ToolSpec.inputSchema` renamed to `ToolSpec.parameters`
- **BREAKING**: Endpoints redesigned to follow REST conventions:
  - `PUT /session` → `POST /sessions`
  - `GET /session/:id` → `GET /sessions/:id`
  - `DELETE /session/:id` → `DELETE /sessions/:id`
  - `GET /session/:id/history` → `GET /sessions/:id/history`
  - `POST /session/:id` → `POST /sessions/:id/turns`
- **BREAKING**: Session creation separated from turn execution — `POST /sessions` only creates the session and optionally seeds history; all agent execution happens via `POST /sessions/:id/turns`
- **BREAKING**: `CreateSessionRequest` — `messages` is now optional, `stream` field removed
- **BREAKING**: `CreateSessionResponse` no longer extends `AgentResponse`; now only contains `{ sessionId }`
- **BREAKING**: `SessionStartEvent` removed; `SSEEvent` union no longer includes it
- **BREAKING**: `Session` constructor (server) — `clientTools` and `history` are now required parameters
- **BREAKING**: `Session` constructor (client) — `tools` and `history` are now required parameters
- **BREAKING**: `Session.create()` (client) — no longer accepts `firstTurn` or `cb`; returns `Session` directly instead of `{ session, pending }`
- **BREAKING**: `Session.runNewSession()` (server) removed
- "Application-side tools" renamed to "client-side tools" in comments and documentation

## [0.6.1] - 2026-04-01

### Fixed

- `GET /sessions` now redacts secret options in each session, consistent with `GET /session/:id`

## [0.6.0] - 2026-04-01

### Changed

- **BREAKING**: `GET /sessions` now returns full session objects (`SessionResponse[]`) instead of an array of IDs (`string[]`)
- **BREAKING**: `GET /session/:id` no longer accepts `?history` query parameter or returns history in the response
- **BREAKING**: `Handler.getSession` no longer accepts a `history` parameter; returns `SessionResponse` without history
- **BREAKING**: `Handler.getSessionHistory` now returns `HistoryMessage[]` instead of `SessionHistoryResponse`; the router handles response formatting
- **BREAKING**: `Handler.getMeta` now returns `Omit<MetaResponse, "version">` instead of `MetaResponse`; the router adds the protocol version
- **BREAKING**: `Session.load()` now accepts `(client, sessionResponse, agentInfo, history?)` instead of fetching the session internally
- **BREAKING**: `Client.listAllSessions()` now returns `SessionResponse[]` instead of `string[]`
- **BREAKING**: `MetaResponse.version` type narrowed from `number` to `2`
- Added `GET /session/:id/history?type=compacted|full` endpoint (`SessionHistoryResponse` type)
- Added `Client.getSessionHistory(sessionId, type)` method
- Protocol version bumped to `2`
- `Client.getMeta()` now throws an error if server protocol version doesn't match expected version

## [0.5.0] - 2026-04-01

### Changes

- `Session.load()` now accepts `agents: AgentInfo[]` instead of a single `agentInfo: AgentInfo`; throws if the session's agent name is not found in the list

## [0.4.2] - 2026-04-01

### Added

- `Session.load(client, sessionId, agentInfo, history?)` in `@agentapplicationprotocol/client` — loads an existing session by ID, optionally fetching `"full"` or `"compacted"` history, and resolves pending tool use; returns `{ session, pending }` like `Session.create()`

### Fixed

- Corrected `main` and `types` entry points in all packages from `dist/index.*` to `dist/src/index.*` to match actual TypeScript build output
- Added `files` field to all packages to exclude `tsconfig.tsbuildinfo`, test files, and examples from the published tarball

## [0.4.1] - 2026-04-01

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

[Unreleased]: https://github.com/agentapplicationprotocol/typescript-sdk/compare/v0.7.3...HEAD
[0.7.3]: https://github.com/agentapplicationprotocol/typescript-sdk/compare/v0.7.2...v0.7.3
[0.7.2]: https://github.com/agentapplicationprotocol/typescript-sdk/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/agentapplicationprotocol/typescript-sdk/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/agentapplicationprotocol/typescript-sdk/compare/v0.6.1...v0.7.0
[0.6.1]: https://github.com/agentapplicationprotocol/typescript-sdk/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/agentapplicationprotocol/typescript-sdk/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/agentapplicationprotocol/typescript-sdk/compare/v0.4.2...v0.5.0
[0.4.2]: https://github.com/agentapplicationprotocol/typescript-sdk/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/agentapplicationprotocol/typescript-sdk/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/agentapplicationprotocol/typescript-sdk/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/agentapplicationprotocol/typescript-sdk/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/agentapplicationprotocol/typescript-sdk/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/agentapplicationprotocol/typescript-sdk/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/agentapplicationprotocol/typescript-sdk/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/agentapplicationprotocol/typescript-sdk/releases/tag/v0.1.0
