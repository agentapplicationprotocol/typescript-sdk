import type {
  HistoryMessage,
  ToolMessage,
  ToolPermissionMessage,
  UserMessage,
} from "./messages.js";
import type { ServerToolRef, ToolSpec } from "./tools.js";

// --- Session ---

export type StreamMode = "delta" | "message" | "none";
export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "refusal" | "error";

/** History type for `GET /sessions/:id/history`. */
export type HistoryType = "compacted" | "full";

/** Agent configuration supplied with a request. */
export interface AgentConfig {
  /** Agent name to invoke. */
  name: string;
  /** Server-side tools to enable. If omitted, all exposed agent tools are disabled. */
  tools?: ServerToolRef[];
  /** Key-value pairs matching the agent's declared options. */
  options?: Record<string, string>;
}

/** Session data shape, used in `GET /sessions/:id` and items in `GET /sessions`. */
export interface SessionInfo {
  sessionId: string;
  /** Secret option values in `agent.options` are redacted (e.g. `"***"`). */
  agent: AgentConfig;
  /** Client-side tools declared for this session. */
  tools?: ToolSpec[];
}

/** Request body for `POST /sessions`. */
export interface CreateSessionRequest {
  /** Agent configuration. `name` is required at session creation. */
  agent: AgentConfig;
  /** Optional seed history (e.g. system prompt or prior conversation). */
  messages?: HistoryMessage[];
  /** Client-side tools with full schema. */
  tools?: ToolSpec[];
}

/** Request body for `POST /sessions/:id/turns`. */
export interface SessionTurnRequest {
  /** Session-level agent overrides. Agent name cannot be changed. Options merged by key. */
  agent?: Omit<AgentConfig, "name">;
  /** Response mode. Defaults to `"none"`. */
  stream?: StreamMode;
  /** A single user message, or a mixed list of tool results and tool permissions. */
  messages: (UserMessage | ToolMessage | ToolPermissionMessage)[];
  /** Client-side tools. Overrides tools declared at session creation. */
  tools?: ToolSpec[];
}
