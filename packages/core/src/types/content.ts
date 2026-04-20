import type { ToolCall } from "./tools.js";

export interface TextContentBlock {
  type: "text";
  text: string;
}

export interface ThinkingContentBlock {
  type: "thinking";
  thinking: string;
}

export interface ToolUseContentBlock extends ToolCall {
  type: "tool_use";
}

export interface ImageContentBlock {
  type: "image";
  /** Supports `https://` URLs and `data:` URIs (base64). */
  url: string;
}

/** A single block of content within a message. */
export type ContentBlock =
  | TextContentBlock
  | ThinkingContentBlock
  | ToolUseContentBlock
  | ImageContentBlock;
