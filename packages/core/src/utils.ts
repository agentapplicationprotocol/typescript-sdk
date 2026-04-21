import type { AgentMessage, ContentBlock, SSEEvent, StopReason } from "./types";

function processEvent(
  event: SSEEvent,
  history: AgentMessage[],
  blocks: ContentBlock[],
  acc: { text: string; thinking: string; stopReason: StopReason },
) {
  if (event.event !== "text_delta" && event.event !== "thinking_delta") {
    // flush delta accumulators when a non-delta event arrives
    if (acc.text) {
      blocks.push({ type: "text", text: acc.text });
      acc.text = "";
    }
    if (acc.thinking) {
      blocks.push({ type: "thinking", thinking: acc.thinking });
      acc.thinking = "";
    }
  }

  switch (event.event) {
    case "text_delta":
      acc.text += event.delta;
      break;
    case "thinking_delta":
      acc.thinking += event.delta;
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
      history.push({
        role: "tool",
        toolCallId: event.toolCallId,
        content: event.content,
      });
      break;
    case "turn_stop":
      acc.stopReason = event.stopReason;
      // finalize the assistant message
      if (blocks.length > 0) history.push({ role: "assistant", content: blocks });
      break;
  }
}

/**
 * Converts a list of SSE events into `HistoryMessage[]`.
 * Handles delta accumulation, tool call/result pairing, and assistant message finalization.
 */
export function sseEventsToMessages(events: SSEEvent[]): [AgentMessage[], StopReason] {
  const history: AgentMessage[] = [];
  const blocks: ContentBlock[] = [];
  const acc = { text: "", thinking: "", stopReason: "error" as StopReason };

  for (const event of events) {
    processEvent(event, history, blocks, acc);
  }

  return [history, acc.stopReason];
}

/**
 * Async variant of `sseEventsToMessages` — consumes an `AsyncIterable<SSEEvent>` directly
 * without accumulating events into an intermediate array.
 */
export async function sseEventsToMessagesAsync(
  events: AsyncIterable<SSEEvent>,
): Promise<[AgentMessage[], StopReason]> {
  const history: AgentMessage[] = [];
  const blocks: ContentBlock[] = [];
  const acc = { text: "", thinking: "", stopReason: "error" as StopReason };

  for await (const event of events) {
    processEvent(event, history, blocks, acc);
  }

  return [history, acc.stopReason];
}
