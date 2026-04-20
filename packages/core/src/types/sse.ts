import type { ToolResult } from "./tools.js";
import type { StopReason } from "./session.js";
import type { ToolCall } from "./tools.js";

export interface TurnStartEvent {
  event: "turn_start";
}

export interface TextDeltaEvent {
  event: "text_delta";
  delta: string;
}

export interface ThinkingDeltaEvent {
  event: "thinking_delta";
  delta: string;
}

export interface TextEvent {
  event: "text";
  text: string;
}

export interface ThinkingEvent {
  event: "thinking";
  thinking: string;
}

export interface ToolCallEvent extends ToolCall {
  event: "tool_call";
}

export interface ToolResultEvent extends ToolResult {
  event: "tool_result";
}

export interface TurnStopEvent {
  event: "turn_stop";
  stopReason: StopReason;
}

/** SSE event data for `stream: "delta"` and `stream: "message"` responses. */
export type SSEEvent =
  | TurnStartEvent
  | TextDeltaEvent // delta mode only
  | ThinkingDeltaEvent // delta mode only
  | TextEvent // message mode only
  | ThinkingEvent // message mode only
  | ToolCallEvent
  | ToolResultEvent // server-side tools only
  | TurnStopEvent;

/** Events emitted in `stream: "delta"` mode. */
export type DeltaSSEEvent =
  | TurnStartEvent
  | TextDeltaEvent
  | ThinkingDeltaEvent
  | ToolCallEvent
  | ToolResultEvent
  | TurnStopEvent;

/** Events emitted in `stream: "message"` mode. */
export type MessageSSEEvent =
  | TurnStartEvent
  | TextEvent
  | ThinkingEvent
  | ToolCallEvent
  | ToolResultEvent
  | TurnStopEvent;
