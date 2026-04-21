import {
  HistoryMessage,
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
  UserMessage,
  ToolMessage,
  ApplicationMessage,
  AgentMessage,
} from "@agentapplicationprotocol/core";
import { ModelProvider } from "./model";
import { Agent } from "./agent";

export type StepIncomingMessage = UserMessage | ToolMessage;

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
    messages: ApplicationMessage[],
  ): Promise<(UserMessage | ToolMessage)[]> {
    const resolved: (UserMessage | ToolMessage)[] = [];
    for (const m of messages) {
      // pass through regular history messages unchanged
      if (m.role !== "tool_permission") {
        resolved.push(m);
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
   * Runs a single LLM step in delta streaming mode: streams the model response, calls
   * `onEvent` for each delta event, executes any trusted inline tools, and returns the
   * generated messages and whether the loop should stop.
   *
   * Override to customize step behavior — same patterns as `runStepStreamNone` apply.
   */
  protected async runStepStreamDelta(
    incoming: StepIncomingMessage[],
    onEvent: (event: DeltaSSEEvent) => void,
  ): Promise<{ generated: AgentMessage[]; stopReason: StopReason | undefined }> {
    // stream the LLM response with current history + incoming messages
    const generated: AgentMessage[] = [];
    let stopReason: StopReason | undefined;
    const events: SSEEvent[] = [];
    try {
      for await (const e of this.model.stream(
        [...this.history, ...incoming],
        this.enabledToolSpecs(),
      )) {
        events.push(e);
        // suppress turn_stop — runTurnDelta emits its own final turn_stop
        if (e.event !== "turn_stop") onEvent(e);
        else stopReason = e.stopReason;
      }
    } catch {
      this.history.push(...incoming);
      onEvent({ event: "turn_stop", stopReason: "error" });
      return { generated, stopReason: "error" };
    }
    const [resMessages] = sseEventsToMessages(events);
    generated.push(...resMessages);

    if (stopReason === "tool_use") {
      const trusted = this.trustedTools();
      const toolUses = resMessages.flatMap((m) =>
        m.role === "assistant" && Array.isArray(m.content)
          ? m.content.filter((b): b is ContentBlock & { type: "tool_use" } => b.type === "tool_use")
          : [],
      );
      const hasUntrusted = toolUses.some((b) => !trusted.has(b.name));

      // execute trusted tools inline and emit tool_result events as they complete
      for (const b of toolUses.filter((b) => trusted.has(b.name))) {
        const content = await this.agent.tools.get(b.name)!(JSON.stringify(b.input));
        const toolMsg: ToolMessage = { role: "tool", toolCallId: b.toolCallId, content };
        generated.push(toolMsg);
        onEvent({ event: "tool_result" as const, toolCallId: b.toolCallId, content });
      }

      // stop only if there are untrusted tools requiring client permission
      stopReason = hasUntrusted ? stopReason : undefined;
    }

    // atomically append incoming + all generated messages (including inline tool results) to history
    this.history.push(...incoming, ...generated);
    return { generated, stopReason };
  }

  /**
   * Runs a single agent turn in delta streaming mode, calling `onEvent` for each SSE event.
   * Resolves permissions, then loops: streams the model, executes any trusted
   * server tools inline, and repeats until a non-tool-use stop or an untrusted
   * tool is encountered.
   */
  async runTurnDelta(
    req: PostSessionTurnRequest,
    onEvent: (event: DeltaSSEEvent) => void,
  ): Promise<void> {
    this.applySessionOverrides(req);
    const incoming = await this.resolvePermissions(req.messages);

    onEvent({ event: "turn_start" as const });

    let next: StepIncomingMessage[] = incoming;

    while (true) {
      const { generated, stopReason } = await this.runStepStreamDelta(next, onEvent);
      if (stopReason !== undefined) {
        onEvent({ event: "turn_stop" as const, stopReason });
        break;
      }
      // pass inline tool results as incoming for the next step
      next = generated.filter((m): m is ToolMessage => m.role === "tool");
    }
  }

  /**
   * Runs a single LLM step in message streaming mode: calls the model, calls `onEvent`
   * for each SSE event, executes any trusted inline tools, and returns the generated
   * messages and whether the loop should stop.
   *
   * Override to customize step behavior — same patterns as `runStepStreamNone` apply.
   */
  protected async runStepStreamMessage(
    incoming: StepIncomingMessage[],
    onEvent: (event: MessageSSEEvent) => void,
  ): Promise<{ generated: AgentMessage[]; stopReason: StopReason | undefined }> {
    // call the model with current history + incoming messages
    const res = await this.model.call([...this.history, ...incoming], this.enabledToolSpecs());
    const generated: AgentMessage[] = [...res.messages];
    let stopReason: StopReason | undefined = res.stopReason;

    // emit SSE events for each assistant message block
    for (const msg of res.messages) {
      if (msg.role === "assistant") {
        const blocks = Array.isArray(msg.content)
          ? msg.content
          : [{ type: "text" as const, text: msg.content }];
        for (const b of blocks) {
          if (b.type === "text") onEvent({ event: "text" as const, text: b.text });
          else if (b.type === "thinking")
            onEvent({ event: "thinking" as const, thinking: b.thinking });
          else if (b.type === "tool_use")
            onEvent({
              event: "tool_call" as const,
              toolCallId: b.toolCallId,
              name: b.name,
              input: b.input,
            });
        }
      }
    }

    if (res.stopReason === "tool_use") {
      const trusted = this.trustedTools();
      const toolUses = res.messages.flatMap((m) =>
        m.role === "assistant" && Array.isArray(m.content)
          ? m.content.filter((b): b is ContentBlock & { type: "tool_use" } => b.type === "tool_use")
          : [],
      );
      const hasUntrusted = toolUses.some((b) => !trusted.has(b.name));

      // execute trusted tools inline and emit tool_result events as they complete
      for (const b of toolUses.filter((b) => trusted.has(b.name))) {
        const content = await this.agent.tools.get(b.name)!(JSON.stringify(b.input));
        const toolMsg: ToolMessage = { role: "tool", toolCallId: b.toolCallId, content };
        generated.push(toolMsg);
        onEvent({ event: "tool_result" as const, toolCallId: b.toolCallId, content });
      }

      // stop only if there are untrusted tools requiring client permission
      stopReason = hasUntrusted ? res.stopReason : undefined;
    }

    // atomically append incoming + all generated messages (including inline tool results) to history
    this.history.push(...incoming, ...generated);
    return { generated, stopReason };
  }

  /**
   * Runs a single agent turn in message streaming mode, calling `onEvent` for each SSE event.
   * Uses a non-streaming LLM call internally, then emits SSE events from the response.
   * Loops on trusted inline tool calls.
   */
  async runTurnMessage(
    req: PostSessionTurnRequest,
    onEvent: (event: MessageSSEEvent) => void,
  ): Promise<void> {
    this.applySessionOverrides(req);
    const incoming = await this.resolvePermissions(req.messages);

    onEvent({ event: "turn_start" as const });

    let next: StepIncomingMessage[] = incoming;

    while (true) {
      const { generated, stopReason } = await this.runStepStreamMessage(next, onEvent);
      if (stopReason !== undefined) {
        onEvent({ event: "turn_stop" as const, stopReason });
        break;
      }
      // pass inline tool results as incoming for the next step
      next = generated.filter((m): m is ToolMessage => m.role === "tool");
    }
  }

  /**
   * Runs a single LLM step without streaming: calls the model, executes any trusted
   * inline tools, and returns the generated messages and whether the loop should stop.
   *
   * Override to customize step behavior, for example:
   * - Filter or transform `incoming` before passing to the model
   * - Collect all generated messages for auditing
   * - Compact history after the step by directly modifying `this.history`
   *
   * The returned `generated` messages are accumulated into the final turn result and can
   * also be filtered in the override if needed.
   *
   * ```ts
   * protected async runStepStreamNone(incoming) {
   *   const filtered = incoming.filter(...);
   *   const res = await super.runStepStreamNone(filtered);
   *   this.fullHistory.push(...res.generated);
   *   this.history = this.history.slice(-MAX);
   *   return res;
   * }
   * ```
   */
  protected async runStepStreamNone(
    incoming: StepIncomingMessage[],
  ): Promise<{ generated: AgentMessage[]; stopReason: StopReason | undefined }> {
    // call the model with current history + incoming messages
    const res = await this.model.call([...this.history, ...incoming], this.enabledToolSpecs());
    const generated: AgentMessage[] = [...res.messages];
    let stopReason: StopReason | undefined = res.stopReason;

    if (res.stopReason === "tool_use") {
      const trusted = this.trustedTools();
      // extract all tool_use blocks from the assistant response
      const toolUses = res.messages.flatMap((m) =>
        m.role === "assistant" && Array.isArray(m.content)
          ? m.content.filter((b): b is ContentBlock & { type: "tool_use" } => b.type === "tool_use")
          : [],
      );
      // execute trusted tools inline and append their results to generated
      const hasUntrusted = toolUses.some((b) => !trusted.has(b.name));
      for (const b of toolUses.filter((b) => trusted.has(b.name))) {
        const content = await this.agent.tools.get(b.name)!(JSON.stringify(b.input));
        generated.push({ role: "tool", toolCallId: b.toolCallId, content });
      }
      // stop only if there are untrusted tools requiring client permission
      stopReason = hasUntrusted ? res.stopReason : undefined;
    }

    // atomically append incoming + all generated messages (including inline tool results) to history
    this.history.push(...incoming, ...generated);
    return { generated, stopReason };
  }

  /**
   * Runs a single agent turn without streaming, returning a complete `PostSessionTurnResponse`.
   * Loops the LLM call as long as all tool calls are trusted and executed inline.
   */
  async runTurnNone(req: PostSessionTurnRequest): Promise<PostSessionTurnResponse> {
    this.applySessionOverrides(req);
    const incoming = await this.resolvePermissions(req.messages);
    const newMessages: AgentMessage[] = [];
    let next: StepIncomingMessage[] = incoming;

    while (true) {
      const { generated, stopReason } = await this.runStepStreamNone(next);
      newMessages.push(...generated);
      if (stopReason !== undefined) return { stopReason, messages: newMessages };
      // pass inline tool results as incoming for the next step
      next = generated.filter((m): m is ToolMessage => m.role === "tool");
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

  /** Serializes the session state for a `GET /session/:id` response. History is not included. */
  toSessionInfo(): SessionInfo {
    return {
      sessionId: this.sessionId,
      agent: this.agentConfig,
      tools: this.clientTools.length ? this.clientTools : undefined,
    };
  }
}
