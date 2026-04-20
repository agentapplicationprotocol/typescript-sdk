import type { StreamMode } from "./session.js";
import type { ServerToolRef, ToolSpec } from "./tools.js";

export interface TextAgentOption {
  type: "text";
  name: string;
  title?: string;
  description?: string;
  default: string;
}

export interface SecretAgentOption {
  type: "secret";
  name: string;
  title?: string;
  description?: string;
  default: string;
}

export interface SelectAgentOption {
  type: "select";
  name: string;
  title?: string;
  description?: string;
  options: string[];
  default: string;
}

/** A configurable option the client may set per request. */
export type AgentOption = TextAgentOption | SecretAgentOption | SelectAgentOption;

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

/** Declares what an agent supports. Missing fields should be treated as unsupported. */
export interface AgentCapabilities {
  /** Declares what history the agent can return in `GET /session/:id`. */
  history?: Partial<Record<HistoryType, Record<string, never>>>;
  /** Declares which stream modes the agent supports. */
  stream?: Partial<Record<StreamMode, Record<string, never>>>;
  /** Declares what application-provided inputs the agent supports. */
  application?: {
    /** Agent accepts client-side tools in requests. */
    tools?: Record<string, never>;
  };
  /** Declares what image input the agent supports. */
  image?: {
    /** Agent accepts `https://` image URLs. */
    http?: Record<string, never>;
    /** Agent accepts `data:` URI (base64) images. */
    data?: Record<string, never>;
  };
}
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
  capabilities?: AgentCapabilities;
}
