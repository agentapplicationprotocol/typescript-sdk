import type {
  AgentMessage,
  DeltaSSEEvent,
  HistoryMessage,
  MessageSSEEvent,
  StopReason,
} from "@agentapplicationprotocol/core";
import { Session, StepIncomingMessage } from "../../session.js";

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

  protected async runStepStreamDelta(
    incoming: StepIncomingMessage[],
    onEvent: (event: DeltaSSEEvent) => void,
  ): Promise<{ generated: AgentMessage[]; stopReason: StopReason | undefined }> {
    const before = this.history.length;
    const res = await super.runStepStreamDelta(incoming, onEvent);
    this.syncAndCompact(before);
    return res;
  }

  protected async runStepStreamMessage(
    incoming: StepIncomingMessage[],
    onEvent: (event: MessageSSEEvent) => void,
  ): Promise<{ generated: AgentMessage[]; stopReason: StopReason | undefined }> {
    const before = this.history.length;
    const res = await super.runStepStreamMessage(incoming, onEvent);
    this.syncAndCompact(before);
    return res;
  }

  protected async runStepStreamNone(
    incoming: StepIncomingMessage[],
  ): Promise<{ generated: AgentMessage[]; stopReason: StopReason | undefined }> {
    const before = this.history.length;
    const res = await super.runStepStreamNone(incoming);
    this.syncAndCompact(before);
    return res;
  }
}
