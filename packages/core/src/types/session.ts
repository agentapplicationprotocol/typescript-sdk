import type { AgentConfig } from "./agent.js";
import type { ToolSpec } from "./tools.js";

// --- Session ---

export type StreamMode = "delta" | "message" | "none";
export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "refusal" | "error";

/** History type for `GET /sessions/:id/history`. */
export type HistoryType = "compacted" | "full";

/** Session data shape, used in `GET /sessions/:id` and items in `GET /sessions`. */
export interface SessionInfo {
  sessionId: string;
  /** Secret option values in `agent.options` are redacted (e.g. `"***"`). */
  agent: AgentConfig;
  /** Client-side tools declared for this session. */
  tools?: ToolSpec[];
}
