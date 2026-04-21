import {
  HistoryMessage,
  ToolPermissionMessage,
  AgentConfig,
  ToolSpec,
  SSEEvent,
  sseEventsToMessages,
  PostSessionTurnResponse,
  StopReason,
  PostSessionTurnRequest,
  ContentBlock,
  SessionInfo,
  DeltaSSEEvent,
  MessageSSEEvent,
} from "@agentapplicationprotocol/core";
import { ModelProvider } from "./model";
import { Agent } from "./agent";

/** Manages a stateful conversation session, accumulating history across turns. */
export class Session {
  sessionId: string;
  agent: Agent;
  agentConfig: AgentConfig;
  /** Client-side tools declared for this session. */
  clientTools: ToolSpec[];
  /** Accumulated conversation history across all turns. */
  history: HistoryMessage[];
  model: ModelProvider;

  constructor(
    sessionId: string,
    agent: Agent,
    model: ModelProvider,
    agentConfig: AgentConfig,
    clientTools: ToolSpec[],
    history: HistoryMessage[],
  ) {
    this.sessionId = sessionId;
    this.agent = agent;
    this.model = model;
    this.agentConfig = agentConfig;
    this.clientTools = clientTools;
    this.history = history;
  }

  /** Resolves tool_permission messages into tool result messages by executing granted tools. */
  private async resolvePermissions(
    messages: (HistoryMessage | ToolPermissionMessage)[],
  ): Promise<HistoryMessage[]> {
    const resolved: HistoryMessage[] = [];
    for (const m of messages) {
      // pass through regular history messages unchanged
      if (m.role !== "tool_permission") {
        resolved.push(m as HistoryMessage);
        continue;
      }
      // for tool_permission, look up the original tool_use block in history to get name + args
      let toolName = "";
      let toolInput = "";
      for (const h of this.history) {
        if (h.role === "assistant" && Array.isArray(h.content)) {
          for (const b of h.content) {
            if (b.type === "tool_use" && b.toolCallId === m.toolCallId) {
              toolName = b.name;
              toolInput = JSON.stringify(b.input);
            }
          }
        }
      }
      // execute the tool if granted, otherwise produce a denial message
      const content =
        m.granted && this.agent.tools.has(toolName)
          ? await this.agent.tools.get(toolName)!(toolInput)
          : `Tool use denied${m.reason ? `: ${m.reason}` : ""}`;
      resolved.push({ role: "tool", toolCallId: m.toolCallId, content });
    }
    return resolved;
  }

  /** Returns the set of trusted server tool names from agentConfig. */
  private trustedTools(): Set<string> {
    return new Set((this.agentConfig.tools ?? []).filter((r) => r.trust).map((r) => r.name));
  }

  /** Returns ToolSpec[] for enabled server tools + client tools to pass to the model. */
  private enabledToolSpecs(): ToolSpec[] {
    const enabledNames = new Set((this.agentConfig.tools ?? []).map((r) => r.name));
    const serverSpecs = (this.agent.info.tools ?? []).filter((t) => enabledNames.has(t.name));
    return [...serverSpecs, ...this.clientTools];
  }

  /**
   * Streams the LLM response for new `messages`.
   * `messages` are combined with history for the LLM call, but only appended
   * to history along with the response once streaming is complete.
   *
   * Override to customize history sent to the model, e.g. compaction or summarization.
   */
  protected async *stream(messages: HistoryMessage[]): AsyncIterable<DeltaSSEEvent> {
    const history = [...this.history, ...messages];
    const events: SSEEvent[] = [];
    try {
      for await (const e of this.model.stream(history, this.enabledToolSpecs())) {
        events.push(e);
        yield e;
      }
    } catch (err) {
      yield { event: "turn_stop", stopReason: "error" };
      return;
    }
    const [resMessages] = sseEventsToMessages(events);
    this.history.push(...messages, ...resMessages);
  }

  /**
   * Calls the LLM with new `messages`.
   * `messages` are combined with history for the LLM call, but only appended
   * to history along with the response once the call is complete.
   *
   * Override to customize history sent to the model, e.g. compaction or summarization.
   */
  protected async call(messages: HistoryMessage[]): Promise<PostSessionTurnResponse> {
    const history = [...this.history, ...messages];
    const res = await this.model.call(history, this.enabledToolSpecs());
    this.history.push(...messages, ...res.messages);
    return res;
  }

  /**
   * Runs a single agent turn in delta streaming mode, yielding SSE events chunk by chunk.
   * Resolves permissions, then loops: streams the model, executes any trusted
   * server tools inline, and repeats until a non-tool-use stop or an untrusted
   * tool is encountered.
   */
  async *runTurnDelta(req: PostSessionTurnRequest): AsyncIterable<DeltaSSEEvent> {
    this.applySessionOverrides(req);
    const messages = req.messages;
    const incoming = await this.resolvePermissions(messages);
    const trusted = this.trustedTools();

    yield { event: "turn_start" as const };

    let stopReason: StopReason = "end_turn";
    let next: HistoryMessage[] = incoming;

    while (true) {
      // stream the LLM response chunk by chunk, forwarding events to the caller
      // suppress turn_stop from stream() — runTurnDelta emits its own final turn_stop
      for await (const e of this.stream(next)) {
        if (e.event === "turn_stop") {
          stopReason = e.stopReason;
          continue;
        }
        yield e;
      }

      // non-tool stop: we're done
      if (stopReason !== "tool_use") break;

      const toolUses = this.lastToolUses();
      // any untrusted tool: return to client for permission
      const untrusted = toolUses.filter((b) => !trusted.has(b.name));
      if (untrusted.length > 0) break;

      // all tools are trusted: execute inline, emit tool_result events, and loop
      next = [];
      for (const b of toolUses) {
        const content = await this.agent.tools.get(b.name)!(JSON.stringify(b.input));
        yield {
          event: "tool_result" as const,
          toolCallId: b.toolCallId,
          content,
        };
        next.push({ role: "tool", toolCallId: b.toolCallId, content });
      }
    }

    yield { event: "turn_stop" as const, stopReason };
  }

  /**
   * Runs a single agent turn in message streaming mode, yielding complete text/thinking
   * events (not deltas). Uses a non-streaming LLM call internally, then emits SSE events
   * from the response. Loops on trusted inline tool calls.
   */
  async *runTurnMessage(req: PostSessionTurnRequest): AsyncIterable<MessageSSEEvent> {
    this.applySessionOverrides(req);
    const messages = req.messages;
    const incoming = await this.resolvePermissions(messages);
    const trusted = this.trustedTools();

    yield { event: "turn_start" as const };

    let stopReason: StopReason = "end_turn";
    let next: HistoryMessage[] = incoming;

    while (true) {
      // call the LLM non-streaming, then emit events from the response messages
      const res = await this.call(next);
      stopReason = res.stopReason;
      next = [];

      for (const msg of res.messages) {
        if (msg.role === "assistant") {
          const blocks = Array.isArray(msg.content)
            ? msg.content
            : [{ type: "text" as const, text: msg.content }];
          for (const b of blocks) {
            if (b.type === "text") yield { event: "text" as const, text: b.text };
            else if (b.type === "thinking")
              yield { event: "thinking" as const, thinking: b.thinking };
            else if (b.type === "tool_use")
              yield {
                event: "tool_call" as const,
                toolCallId: b.toolCallId,
                name: b.name,
                input: b.input,
              };
          }
        }
      }

      // non-tool stop: we're done
      if (stopReason !== "tool_use") break;

      const toolUses = this.lastToolUses();
      // any untrusted tool: return to client for permission
      const untrusted = toolUses.filter((b) => !trusted.has(b.name));
      if (untrusted.length > 0) break;

      // all tools are trusted: execute inline, emit tool_result events, and loop
      for (const b of toolUses) {
        const content = await this.agent.tools.get(b.name)!(JSON.stringify(b.input));
        yield {
          event: "tool_result" as const,
          toolCallId: b.toolCallId,
          content,
        };
        next.push({ role: "tool", toolCallId: b.toolCallId, content });
      }
    }

    yield { event: "turn_stop" as const, stopReason };
  }

  /**
   * Runs a single agent turn without streaming, returning a complete `PostSessionTurnResponse`.
   * Loops the LLM call as long as all tool calls are trusted and executed inline.
   */
  async runTurnNone(req: PostSessionTurnRequest): Promise<PostSessionTurnResponse> {
    this.applySessionOverrides(req);
    const messages = req.messages;
    const incoming = await this.resolvePermissions(messages);
    const trusted = this.trustedTools();
    const newMessages: HistoryMessage[] = [];
    let next: HistoryMessage[] = incoming;

    while (true) {
      // call the LLM with the next batch of messages
      const res = await this.call(next);
      newMessages.push(...res.messages);

      // non-tool stop: we're done
      if (res.stopReason !== "tool_use")
        return { stopReason: res.stopReason, messages: newMessages };

      const toolUses = this.lastToolUses();
      // any untrusted tool: return to client for permission
      const untrusted = toolUses.filter((b) => !trusted.has(b.name));
      if (untrusted.length > 0) return { stopReason: "tool_use", messages: newMessages };

      // all tools are trusted: execute inline and loop
      next = [];
      for (const b of toolUses) {
        const content = await this.agent.tools.get(b.name)!(JSON.stringify(b.input));
        next.push({ role: "tool", toolCallId: b.toolCallId, content });
      }
      newMessages.push(...next);
    }
  }

  /** Applies config overrides from the request that persist for the session lifetime: client tools, enabled/trusted agent tools, and agent options. */
  private applySessionOverrides(req: PostSessionTurnRequest): void {
    // Override client-provided tools
    if (req.tools) this.clientTools = req.tools;
    // Override enabled and trusted agent tools
    if (req.agent?.tools) this.agentConfig = { ...this.agentConfig, tools: req.agent.tools };
    // Override options by field; omit a field to keep current value, use its default value to reset
    if (req.agent?.options)
      this.agentConfig = {
        ...this.agentConfig,
        options: { ...this.agentConfig.options, ...req.agent.options },
      };
  }

  /** Returns all `tool_use` blocks from the most recent assistant message in history. */
  private lastToolUses(): {
    toolCallId: string;
    name: string;
    input: Record<string, unknown>;
  }[] {
    const last = [...this.history].reverse().find((m) => m.role === "assistant");
    if (!last || !Array.isArray(last.content)) return [];
    return last.content.filter(
      (b): b is ContentBlock & { type: "tool_use" } => b.type === "tool_use",
    );
  }

  /** Serializes the session state for a `GET /session/:id` response. History is not included. */
  toSessionResponse(): SessionInfo {
    return {
      sessionId: this.sessionId,
      agent: this.agentConfig,
      tools: this.clientTools.length ? this.clientTools : undefined,
    };
  }
}
