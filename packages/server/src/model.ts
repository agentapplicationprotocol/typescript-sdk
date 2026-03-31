import {
  HistoryMessage,
  ToolSpec,
  SSEEvent,
  AgentResponse,
  sseEventsToMessagesAsync,
} from "@agentapplicationprotocol/core";

/**
 * Base class for LLM backends. Subclasses must implement `stream`.
 * By default, `call` falls back to streaming mode, but overriding it with a
 * native non-streaming call is more efficient when the LLM supports it.
 */
export abstract class ModelProvider {
  /** Calls the LLM in streaming mode and yields SSE events as they arrive. */
  abstract stream(history: HistoryMessage[], tools: ToolSpec[]): AsyncIterable<SSEEvent>;

  /** Calls the LLM in non-streaming mode and returns a complete AgentResponse. Falls back to streaming if not overridden. */
  async call(history: HistoryMessage[], tools: ToolSpec[]): Promise<AgentResponse> {
    const [messages, stopReason] = await sseEventsToMessagesAsync(this.stream(history, tools));
    return { messages, stopReason };
  }
}
