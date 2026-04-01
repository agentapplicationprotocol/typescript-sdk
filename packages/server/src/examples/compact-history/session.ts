import type { AgentResponse, DeltaSSEEvent, HistoryMessage } from "@agentapplicationprotocol/core";
import { Session } from "../../session.js";

/** In-memory session store. */
export const sessions = new Map<string, TruncatedHistorySession>();

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
 * Session subclass with sliding-window history compaction.
 * `this.history` holds the compacted window sent to the model.
 * `fullHistory` retains the complete uncompacted history.
 */
export class TruncatedHistorySession extends Session {
  fullHistory: HistoryMessage[] = [];

  /** Appends new history entries to `fullHistory` and trims `this.history` to the compacted window. */
  private syncAndCompact(before: number) {
    this.fullHistory.push(...this.history.slice(before));
    this.history = compact(this.history);
  }

  /** Streams the model response, then compacts history. */
  protected async *stream(messages: HistoryMessage[]): AsyncIterable<DeltaSSEEvent> {
    const before = this.history.length;
    for await (const e of super.stream(messages)) yield e;
    this.syncAndCompact(before);
  }

  /** Calls the model, then compacts history. */
  protected async call(messages: HistoryMessage[]): Promise<AgentResponse> {
    const before = this.history.length;
    const res = await super.call(messages);
    this.syncAndCompact(before);
    return res;
  }
}
