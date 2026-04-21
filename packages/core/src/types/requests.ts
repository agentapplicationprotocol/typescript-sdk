import type { ApplicationMessage, HistoryMessage } from "./messages.js";
import type { AgentConfig } from "./agent.js";
import type { StreamMode } from "./session.js";
import type { ToolSpec } from "./tools.js";

/** Request body for `POST /sessions`. */
export interface PostSessionsRequest {
  /** Agent configuration. `name` is required at session creation. */
  agent: AgentConfig;
  /** Optional seed history (e.g. system prompt or prior conversation). */
  messages?: HistoryMessage[];
  /** Client-side tools with full schema. */
  tools?: ToolSpec[];
}

/** Request body for `POST /sessions/:id/turns`. */
export interface PostSessionTurnRequest {
  /** Session-level agent overrides. Agent name cannot be changed. Options merged by key. */
  agent?: Omit<AgentConfig, "name">;
  /** Response mode. Defaults to `"none"`. */
  stream?: StreamMode;
  /** A single user message, or a mixed list of tool results and tool permissions. */
  messages: ApplicationMessage[];
  /** Client-side tools. Overrides tools declared at session creation. */
  tools?: ToolSpec[];
}
