import type { ContentBlock, HistoryMessage, SSEEvent, ToolCallEvent, ToolSpec } from "./types";

/**
 * Converts a list of SSE events into `HistoryMessage[]`.
 * Handles delta accumulation, tool call/result pairing, and assistant message finalization.
 */
export function sseEventsToMessages(events: SSEEvent[]): HistoryMessage[] {
  const history: HistoryMessage[] = [];
  const blocks: ContentBlock[] = [];
  let textAcc = "";
  let thinkingAcc = "";

  for (const event of events) {
    // flush delta accumulators when a non-delta event arrives
    if (event.event !== "text_delta" && event.event !== "thinking_delta") {
      if (textAcc) {
        blocks.push({ type: "text", text: textAcc });
        textAcc = "";
      }
      if (thinkingAcc) {
        blocks.push({ type: "thinking", thinking: thinkingAcc });
        thinkingAcc = "";
      }
    }

    switch (event.event) {
      case "text_delta":
        textAcc += event.delta;
        break;
      case "thinking_delta":
        thinkingAcc += event.delta;
        break;
      case "text":
        blocks.push({ type: "text", text: event.text });
        break;
      case "thinking":
        blocks.push({ type: "thinking", thinking: event.thinking });
        break;
      case "tool_call":
        // accumulate tool_use blocks into the current assistant message
        blocks.push({
          type: "tool_use",
          toolCallId: event.toolCallId,
          name: event.name,
          input: event.input,
        });
        break;
      case "tool_result":
        // flush accumulated assistant blocks before appending the tool result
        if (blocks.length > 0) {
          history.push({ role: "assistant", content: [...blocks] });
          blocks.length = 0;
        }
        history.push({ role: "tool", toolCallId: event.toolCallId, content: event.content });
        break;
      case "turn_stop":
        // finalize the assistant message
        if (blocks.length > 0) history.push({ role: "assistant", content: blocks });
        break;
    }
  }

  return history;
}

/**
 * Inspects the last assistant message in `messages` and classifies its unresolved `tool_use` blocks
 * into client-side tools (matched against `clientTools`) and server-side tools (requiring permission).
 */
export function resolvePendingToolUse(
  messages: HistoryMessage[],
  clientTools?: ToolSpec[],
): { client: ToolCallEvent[]; server: ToolCallEvent[] } {
  const last = [...messages].reverse().find((m) => m.role === "assistant");
  if (!last || !Array.isArray(last.content)) return { client: [], server: [] };

  const resolved = new Set(messages.filter((m) => m.role === "tool").map((m) => m.toolCallId));

  const clientNames = new Set(clientTools?.map((t) => t.name) ?? []);
  const client: ToolCallEvent[] = [];
  const server: ToolCallEvent[] = [];

  for (const block of last.content) {
    if (block.type !== "tool_use" || resolved.has(block.toolCallId)) continue;
    const { toolCallId, name, input } = block;
    (clientNames.has(name) ? client : server).push({ toolCallId, name, input });
  }

  return { client, server };
}
