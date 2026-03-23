import type { JSONSchema7 } from "json-schema";

export type JSONSchema = JSONSchema7;

// Agent Application Protocol — TypeScript types
// https://github.com/agentapplicationprotocol/agent-application-protocol

// --- Content blocks ---

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "tool_use"; toolCallId: string; name: string; input: Record<string, unknown> }
  | { type: "image"; mimeType: string; data: string };

// --- Messages ---

export type Message =
  | { role: "system"; content: string }
  | { role: "user"; content: string | ContentBlock[] }
  | { role: "assistant"; content: string | ContentBlock[] }
  | { role: "tool"; toolCallId: string; content: string | ContentBlock[] }
  | { role: "tool_permission"; toolCallId: string; granted: boolean; reason?: string };

// --- Tools ---

export interface ToolSpec {
  name: string;
  title?: string;
  description: string;
  inputSchema: JSONSchema;
}

export interface ServerToolRef {
  name: string;
  trust: boolean;
}

// --- Agent options ---

export type AgentOption =
  | { name: string; title?: string; description: string; type: "text"; default: string }
  | { name: string; title?: string; description: string; type: "select"; options: string[]; default: string };

// --- Meta ---

export interface AgentInfo {
  name: string;
  title?: string;
  version: string;
  description: string;
  tools: ToolSpec[];
  options: AgentOption[];
  capabilities: {
    history: {
      compacted: boolean;
      full: boolean;
    };
  };
}

export interface MetaResponse {
  version: number;
  agents: AgentInfo[];
}

// --- Session ---

export type StreamMode = "chunk" | "message" | "none";
export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "refusal" | "error" | "cancelled";

export interface CreateSessionRequest {
  agent: string;
  stream?: StreamMode;
  messages: Message[];
  tools?: ToolSpec[];
  serverTools?: ServerToolRef[];
  options?: Record<string, string>;
}

export interface SessionTurnRequest {
  stream?: StreamMode;
  messages: Message[];
  tools?: ToolSpec[];
  serverTools?: ServerToolRef[];
  options?: Record<string, string>;
}

export interface AgentResponse {
  sessionId?: string;
  stopReason: StopReason;
  messages: Message[];
}

export interface SessionResponse {
  sessionId: string;
  agent: string;
  tools: ToolSpec[];
  serverTools: ServerToolRef[];
  options: Record<string, string>;
  history?: {
    compacted?: Message[];
    full?: Message[];
  };
}

export interface SessionListResponse {
  sessions: string[];
  nextCursor?: string;
}

// --- SSE events ---

export type SSEEvent =
  | { event: "session_start"; sessionId: string }
  | { event: "message_start" }
  | { event: "text_delta"; delta: string }
  | { event: "thinking_delta"; delta: string }
  | { event: "text"; text: string }
  | { event: "thinking"; thinking: string }
  | { event: "tool_call"; toolCallId: string; name: string; input: Record<string, unknown> }
  | { event: "tool_result"; toolCallId: string; content: string | ContentBlock[] }
  | { event: "message_stop"; stopReason: StopReason };
