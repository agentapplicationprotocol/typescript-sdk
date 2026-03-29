import type { JSONSchema7 } from "json-schema";

export type JSONSchema = JSONSchema7;

// Agent Application Protocol — TypeScript types
// https://github.com/agentapplicationprotocol/agent-application-protocol

// --- Content blocks ---

/** A single block of content within a message. */
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | {
      type: "tool_use";
      toolCallId: string;
      name: string;
      input: Record<string, unknown>;
    }
  | {
      type: "image";
      /** Supports `https://` URLs and `data:` URIs (base64). */
      url: string;
    };

// --- Messages ---

/** A system-role message providing instructions to the agent. */
export interface SystemMessage {
  role: "system";
  content: string;
}

/** A user-role message. */
export interface UserMessage {
  role: "user";
  content: string | ContentBlock[];
}

/** An assistant-role message. */
export interface AssistantMessage {
  role: "assistant";
  content: string | ContentBlock[];
}

/** A tool result message returned by the application after a `tool_use` block. */
export interface ToolMessage {
  role: "tool";
  toolCallId: string;
  content: string | ContentBlock[];
}

/** A message that can appear in conversation history. */
export type HistoryMessage = SystemMessage | UserMessage | AssistantMessage | ToolMessage;

/** Grants or denies permission for the server to invoke a tool on the client's behalf. */
export interface ToolPermissionMessage {
  role: "tool_permission";
  toolCallId: string;
  /** Whether the client grants permission for the tool call. */
  granted: boolean;
  /** Optional explanation, especially useful when `granted` is `false`. */
  reason?: string;
}

// --- Tools ---

/** Declares a tool (application-side in requests; server-side in `/meta`). */
export interface ToolSpec {
  name: string;
  title?: string;
  description: string;
  inputSchema: JSONSchema;
}

/** References a server-side tool to enable for a session. */
export interface ServerToolRef {
  /** Server tool name as declared in `/meta`. */
  name: string;
  /** If `true`, the server may invoke this tool without requesting client permission. Defaults to `false`. */
  trust?: boolean;
}

// --- Agent options ---

/** A configurable option the client may set per request. */
export type AgentOption =
  | {
      type: "text";
      name: string;
      title?: string;
      description?: string;
      default: string;
    }
  | {
      type: "secret";
      name: string;
      title?: string;
      description?: string;
      default: string;
    }
  | {
      type: "select";
      name: string;
      title?: string;
      description?: string;
      options: string[];
      default: string;
    };

// --- Meta ---

/** Describes an agent available on the server, as returned by `GET /meta`. */
export interface AgentInfo {
  /** Unique identifier for the agent on this server. */
  name: string;
  /** Human-readable display name. */
  title?: string;
  /** Semantic version of the agent. */
  version: string;
  description?: string;
  /** Server-side tools the agent exposes to the client for configuration. */
  tools?: ToolSpec[];
  /** Configurable options the client may set per request. */
  options?: AgentOption[];
  /** Declares what the agent supports. Missing fields should be treated as unsupported. */
  capabilities?: {
    /** Declares what history the agent can return in `GET /session/:id`. */
    history?: {
      /** Server can return compacted history. */
      compacted?: Record<string, never>;
      /** Server can return full uncompacted history. */
      full?: Record<string, never>;
    };
    /** Declares which stream modes the agent supports. */
    stream?: {
      /** Agent supports `"delta"` streaming. */
      delta?: Record<string, never>;
      /** Agent supports `"message"` streaming. */
      message?: Record<string, never>;
      /** Agent supports non-streaming (`"none"`) responses. */
      none?: Record<string, never>;
    };
    /** Declares what application-provided inputs the agent supports. */
    application?: {
      /** Agent accepts application-side tools in requests. */
      tools?: Record<string, never>;
    };
    /** Declares what image input the agent supports. */
    image?: {
      /** Agent accepts `https://` image URLs. */
      http?: Record<string, never>;
      /** Agent accepts `data:` URI (base64) images. */
      data?: Record<string, never>;
    };
  };
}

/** Response body for `GET /meta`. */
export interface MetaResponse {
  /** AAP protocol version. */
  version: number;
  agents: AgentInfo[];
}

// --- Session ---

export type StreamMode = "delta" | "message" | "none";
export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "refusal" | "error";

/** Agent configuration supplied with a request. */
export interface AgentConfig {
  /** Agent name to invoke. */
  name: string;
  /** Server-side tools to enable. If omitted, all exposed agent tools are disabled. */
  tools?: ServerToolRef[];
  /** Key-value pairs matching the agent's declared options. */
  options?: Record<string, string>;
}

/** Request body for `PUT /session`. */
export interface CreateSessionRequest {
  /** Agent configuration. `name` is required at session creation. */
  agent: AgentConfig;
  /** Response mode. Defaults to `"none"`. */
  stream?: StreamMode;
  /** Seed history. The last message must be a `user` message. */
  messages: HistoryMessage[];
  /** Application-side tools with full schema. */
  tools?: ToolSpec[];
}

/** Request body for `POST /session/:id`. */
export interface SessionTurnRequest {
  /** Session-level agent overrides. Agent name cannot be changed. */
  agent?: Omit<AgentConfig, "name">;
  /** Response mode. Defaults to `"none"`. */
  stream?: StreamMode;
  /** A single user message, or a mixed list of tool results and tool permissions. */
  messages: (UserMessage | ToolMessage | ToolPermissionMessage)[];
  /** Application-side tools. Overrides tools declared at session creation. */
  tools?: ToolSpec[];
}

/** JSON response body for non-streaming (`stream: "none"`) requests. */
export interface AgentResponse {
  stopReason: StopReason;
  messages: HistoryMessage[];
}

export interface CreateSessionResponse extends AgentResponse {
  sessionId: string;
}

/** Response body for `GET /session/:id`. */
export interface SessionResponse {
  sessionId: string;
  /** Secret option values in `agent.options` are redacted (e.g. `"***"`). */
  agent: AgentConfig;
  /** Application-side tools declared for this session. */
  tools?: ToolSpec[];
  history?: {
    /** Omitted if the server chooses not to expose. */
    compacted?: HistoryMessage[];
    /** Omitted if the server chooses not to expose. */
    full?: HistoryMessage[];
  };
}

/** Response body for `GET /sessions`. */
export interface SessionListResponse {
  /** Array of session IDs. */
  sessions: string[];
  /** Pagination cursor; absent when there are no more results. Pass as `after` to get the next page. */
  next?: string;
}

// --- SSE events ---

/** A tool call emitted by the agent during a streaming turn. */
export interface ToolCallEvent {
  toolCallId: string;
  name: string;
  input: Record<string, unknown>;
}

/** SSE event data for `stream: "delta"` and `stream: "message"` responses. */
export type SSEEvent =
  | { event: "session_start"; sessionId: string } // PUT /session only
  | { event: "turn_start" }
  | { event: "text_delta"; delta: string } // delta mode only
  | { event: "thinking_delta"; delta: string } // delta mode only
  | { event: "text"; text: string } // message mode only
  | { event: "thinking"; thinking: string } // message mode only
  | ({ event: "tool_call" } & ToolCallEvent)
  | {
      event: "tool_result";
      toolCallId: string;
      content: string | ContentBlock[];
    } // server-side tools only
  | { event: "turn_stop"; stopReason: StopReason };
