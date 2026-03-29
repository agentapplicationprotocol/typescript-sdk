import type { JSONSchema7 } from "json-schema";

export type JSONSchema = JSONSchema7;

// Agent Application Protocol — TypeScript types
// https://github.com/agentapplicationprotocol/agent-application-protocol

// --- Content blocks ---

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "tool_use"; toolCallId: string; name: string; input: Record<string, unknown> }
  | { type: "image"; url: string }; // supports https:// and data: URIs

// --- Messages ---

export interface SystemMessage {
  role: "system";
  content: string;
}

export interface UserMessage {
  role: "user";
  content: string | ContentBlock[];
}

export interface AssistantMessage {
  role: "assistant";
  content: string | ContentBlock[];
}

export interface ToolMessage {
  role: "tool";
  toolCallId: string;
  content: string | ContentBlock[];
}

export type HistoryMessage = SystemMessage | UserMessage | AssistantMessage | ToolMessage;

export interface ToolPermissionMessage {
  role: "tool_permission";
  toolCallId: string;
  granted: boolean;
  reason?: string;
}

// --- Tools ---

export interface ToolSpec {
  name: string;
  title?: string;
  description: string;
  inputSchema: JSONSchema;
}

export interface ServerToolRef {
  name: string;
  trust?: boolean; // default: false
}

// --- Agent options ---

export type AgentOption =
  | { type: "text"; name: string; title?: string; description?: string; default: string }
  | { type: "secret"; name: string; title?: string; description?: string; default: string }
  | { type: "select"; name: string; title?: string; description?: string; options: string[]; default: string };

// --- Meta ---

export interface AgentInfo {
  name: string;
  title?: string;
  version: string;
  description?: string;
  tools?: ToolSpec[];
  options?: AgentOption[];
  capabilities?: {
    history?: {
      compacted?: Record<string, never>;
      full?: Record<string, never>;
    };
    stream?: {
      delta?: Record<string, never>;
      message?: Record<string, never>;
      none?: Record<string, never>;
    };
    application?: {
      tools?: Record<string, never>;
    };
    image?: {
      http?: Record<string, never>;
      data?: Record<string, never>;
    };
  };
}

export interface MetaResponse {
  version: number;
  agents: AgentInfo[];
}

// --- Session ---

export type StreamMode = "delta" | "message" | "none";
export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "refusal" | "error";

export interface AgentConfig {
  name: string;
  tools?: ServerToolRef[];
  options?: Record<string, string>;
}

export interface CreateSessionRequest {
  agent: AgentConfig;
  stream?: StreamMode;
  messages: HistoryMessage[]; // seed history; last message must be a user message
  tools?: ToolSpec[];
}

export interface SessionTurnRequest {
  stream?: StreamMode;
  messages: (UserMessage | ToolMessage | ToolPermissionMessage)[];
  tools?: ToolSpec[];
  agent?: Omit<AgentConfig, "name">;
}

export interface AgentResponse {
  sessionId?: string;
  stopReason: StopReason;
  messages: HistoryMessage[];
}

export interface SessionResponse {
  sessionId: string;
  agent: AgentConfig;
  tools?: ToolSpec[];
  history?: {
    compacted?: HistoryMessage[];
    full?: HistoryMessage[];
  };
}

export interface SessionListResponse {
  sessions: string[];
  next?: string; // absent when no more results
}

// --- SSE events ---

export type SSEEvent =
  | { event: "session_start"; sessionId: string }
  | { event: "turn_start" }
  | { event: "text_delta"; delta: string }
  | { event: "thinking_delta"; delta: string }
  | { event: "text"; text: string }
  | { event: "thinking"; thinking: string }
  | { event: "tool_call"; toolCallId: string; name: string; input: Record<string, unknown> }
  | { event: "tool_result"; toolCallId: string; content: string | ContentBlock[] }
  | { event: "turn_stop"; stopReason: StopReason };
