import {
  AgentConfig,
  AgentInfo,
  AgentResponse,
  CreateSessionRequest,
  HistoryMessage,
  SessionResponse,
  SessionTurnRequest,
  sseEventsToMessages,
  SSEEvent,
  ToolCallEvent,
  ToolSpec,
} from "@agentapplicationprotocol/core";
import { Client } from "./client";
import { resolvePendingToolUse } from "./utils";

/** Unresolved tool calls from a turn, split by origin. */
export interface PendingToolUse {
  /** Client-side tools — execute locally and send results back via `tool` messages. */
  client: ToolCallEvent[];
  /** Server-side tools — send `tool_permission` messages to grant or deny. */
  server: ToolCallEvent[];
}

/** A stateful client-side session that accumulates history across turns. */
export class Session {
  sessionId: string;
  client: Client;
  /** Metadata for the agent this session is running against. */
  agent: AgentInfo;
  agentConfig: AgentConfig;
  /** Client-side tools declared for this session. */
  tools: ToolSpec[];
  /** Accumulated conversation history across all turns. */
  history: HistoryMessage[];

  private constructor(
    sessionId: string,
    client: Client,
    agent: AgentInfo,
    agentConfig: AgentConfig,
    tools: ToolSpec[],
    history: HistoryMessage[],
  ) {
    this.sessionId = sessionId;
    this.client = client;
    this.agent = agent;
    this.agentConfig = agentConfig;
    this.tools = tools;
    this.history = history;
  }

  /**
   * Creates a new session.
   * @param agentInfo - Agent metadata (e.g. from `client.getMeta()`).
   * @returns The created session.
   */
  static async create(
    client: Client,
    req: CreateSessionRequest,
    agentInfo: AgentInfo,
  ): Promise<Session> {
    const { sessionId } = await client.createSession(req);
    const session = new Session(
      sessionId,
      client,
      agentInfo,
      req.agent,
      req.tools ?? [],
      req.messages ?? [],
    );
    return session;
  }

  /**
   * Loads an existing session and resolves any pending tool use.
   * @param res - Session response from `client.getSession()`.
   * @param agentInfo - Agent metadata matching the session's agent.
   * @param history - If provided, fetches history of the given type.
   * @returns The loaded session and any pending tool calls.
   */
  static async load(
    client: Client,
    res: SessionResponse,
    agentInfo: AgentInfo,
    history?: "full" | "compacted",
  ): Promise<{ session: Session; pending: PendingToolUse }> {
    const session = new Session(res.sessionId, client, agentInfo, res.agent, res.tools ?? [], []);
    if (history) {
      const histRes = await client.getSessionHistory(res.sessionId, history);
      const h = history === "compacted" ? histRes.history.compacted : histRes.history.full;
      session.history.push(...(h ?? []));
    }
    return {
      session,
      pending: resolvePendingToolUse(session.history, session.tools),
    };
  }

  /**
   * Sends a turn to the server and appends the result to history.
   * Strips `tools` and `agent` fields that are unchanged from the current session state.
   * Updates `tools` if `req.tools` is provided.
   * @param cb - Optional callback invoked for each SSE event in streaming mode.
   * @returns Any pending tool calls from this turn.
   */
  async send(req: SessionTurnRequest, cb?: (e: SSEEvent) => void): Promise<PendingToolUse> {
    // Strip unchanged tools (compare by JSON equality)
    const toolsChanged =
      req.tools !== undefined && JSON.stringify(req.tools) !== JSON.stringify(this.tools);

    // Strip unchanged agent overrides.
    // For agent.options: omit unchanged fields, provide new value if changed,
    // or provide the option's default value to reset it.
    const agentToolsChanged =
      req.agent?.tools !== undefined &&
      JSON.stringify(req.agent.tools) !== JSON.stringify(this.agentConfig.tools);
    // Only send option keys whose values differ from the current session state
    const changedOptions = req.agent?.options
      ? Object.fromEntries(
          Object.entries(req.agent.options).filter(([k, v]) => this.agentConfig.options?.[k] !== v),
        )
      : undefined;
    const agentOptionsChanged = changedOptions && Object.keys(changedOptions).length > 0;

    const cleanReq: SessionTurnRequest = {
      ...req,
      tools: toolsChanged ? req.tools : undefined,
      agent:
        agentToolsChanged || agentOptionsChanged
          ? {
              tools: agentToolsChanged ? req.agent!.tools : undefined,
              options: agentOptionsChanged ? changedOptions : undefined,
            }
          : undefined,
    };

    if (toolsChanged) this.tools = req.tools!;
    if (agentToolsChanged) this.agentConfig = { ...this.agentConfig, tools: req.agent!.tools };
    if (agentOptionsChanged)
      this.agentConfig = {
        ...this.agentConfig,
        options: { ...this.agentConfig.options, ...req.agent!.options },
      };

    let newMessages: HistoryMessage[];

    if (cleanReq.stream === "delta" || cleanReq.stream === "message") {
      const stream = await this.client.sendTurn(
        this.sessionId,
        cleanReq as SessionTurnRequest & { stream: "delta" | "message" },
      );
      const events: SSEEvent[] = [];
      for await (const e of stream) {
        events.push(e);
        cb?.(e);
      }
      [newMessages] = sseEventsToMessages(events);
    } else {
      const res = await this.client.sendTurn(
        this.sessionId,
        cleanReq as SessionTurnRequest & { stream?: "none" },
      );
      newMessages = (res as AgentResponse).messages;
    }

    this.history.push(...(req.messages as HistoryMessage[]), ...newMessages);
    return resolvePendingToolUse(this.history, this.tools);
  }
}
