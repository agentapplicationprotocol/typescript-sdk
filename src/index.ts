export { Client, ClientError } from "./client";
export type { ClientOptions } from "./client";
export { Server, writeSSEEvents } from "./server";
export type { ServerHandler, ServerOptions } from "./server";
export type {
  // Core types
  HistoryMessage,
  SystemMessage,
  UserMessage,
  AssistantMessage,
  ToolMessage,
  ToolPermissionMessage,
  ContentBlock,
  ToolSpec,
  ServerToolRef,
  AgentOption,
  StreamMode,
  StopReason,
  JSONSchema,
  // Request/response types
  AgentConfig,
  CreateSessionRequest,
  SessionTurnRequest,
  AgentResponse,
  SessionResponse,
  SessionListResponse,
  MetaResponse,
  AgentInfo,
  SSEEvent,
} from "./types";
