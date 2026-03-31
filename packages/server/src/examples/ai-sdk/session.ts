import type { AgentResponse, HistoryMessage, SSEEvent } from "@agentapplicationprotocol/core";
import { Session } from "../../session.js";
import { AiModelProvider } from "../../model.js";
import { createOpenAI } from "@ai-sdk/openai";
import type { Agent } from "../../agent.js";
import type { AgentConfig, ToolSpec } from "@agentapplicationprotocol/core";

export const sessions = new Map<string, AiSDKSession>();

const COMPACTED_HISTORY_SIZE = 10;

/** Trims history to the last `COMPACTED_HISTORY_SIZE` messages, ensuring the window never starts on a `tool` message. */
function compact(history: HistoryMessage[]): HistoryMessage[] {
  if (history.length <= COMPACTED_HISTORY_SIZE) return history;
  let start = history.length - COMPACTED_HISTORY_SIZE;
  // skip leading tool messages to avoid orphaned tool results
  while (start < history.length && history[start].role === "tool") start++;
  return history.slice(start);
}

/**
 * AI SDK session with sliding-window history compaction.
 * `this.history` holds the compacted window sent to the model.
 * `fullHistory` retains the complete uncompacted history.
 */
export class AiSDKSession extends Session {
  fullHistory: HistoryMessage[] = [];

  constructor(
    sessionId: string,
    agent: Agent,
    agentConfig: AgentConfig,
    clientTools: ToolSpec[] = [],
  ) {
    const openai = createOpenAI({
      baseURL: agentConfig.options?.baseURL || undefined,
      apiKey: agentConfig.options?.apiKey || undefined,
    });
    super(
      sessionId,
      agent,
      new AiModelProvider(openai.chat(agentConfig.options?.model ?? "gpt-4o")),
      agentConfig,
      clientTools,
    );
  }

  private syncAndCompact(before: number) {
    this.fullHistory.push(...this.history.slice(before));
    this.history = compact(this.history);
  }

  protected async *stream(messages: HistoryMessage[]): AsyncIterable<SSEEvent> {
    const before = this.history.length;
    for await (const e of super.stream(messages)) yield e;
    this.syncAndCompact(before);
  }

  protected async call(messages: HistoryMessage[]): Promise<AgentResponse> {
    const before = this.history.length;
    const res = await super.call(messages);
    this.syncAndCompact(before);
    return res;
  }
}
