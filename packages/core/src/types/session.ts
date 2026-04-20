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
