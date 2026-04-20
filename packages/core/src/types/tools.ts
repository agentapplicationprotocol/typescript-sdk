import type { JSONSchema7 } from "json-schema";
import type { ContentBlock } from "./content.js";

export type JSONSchema = JSONSchema7;

/** Input arguments for a tool call. */
export type ToolCallInput = Record<string, unknown>;

/** A tool call emitted by the agent. */
export interface ToolCall {
  toolCallId: string;
  name: string;
  input: ToolCallInput;
}

/** The result of a tool call. */
export interface ToolResult {
  toolCallId: string;
  content: string | ContentBlock[];
}

/** Declares a tool (client-side in requests; server-side in `/meta`). */
export interface ToolSpec {
  name: string;
  title?: string;
  description: string;
  parameters: JSONSchema;
}

/** References a server-side tool to enable for a session. */
export interface ServerToolRef {
  /** Server tool name as declared in `/meta`. */
  name: string;
  /** If `true`, the server may invoke this tool without requesting client permission. Defaults to `false`. */
  trust?: boolean;
}
