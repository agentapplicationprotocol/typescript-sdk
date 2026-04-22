import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { SSEStreamingApi } from "hono/streaming";
import {
  AgentInfo,
  GetMetaResponse,
  GetSessionsResponse,
  PostSessionTurnResponse,
  PostSessionsResponse,
  PostSessionsRequest,
  HistoryMessage,
  HistoryType,
  SessionInfo,
  PostSessionTurnRequest,
  SSEEvent,
  DeltaSSEEvent,
  MessageSSEEvent,
} from "@agentapplicationprotocol/core";
import type { Session } from "./session.js";

// --- Handler interface ---

/** Implemented by session objects that can be serialized to AAP's `SessionInfo` shape. */
export interface ToSessionInfo {
  toSessionInfo(): SessionInfo;
}

export interface Handler<T extends ToSessionInfo = Session> {
  /** Returns server metadata and agent list for `GET /meta`. */
  getMeta(): Omit<GetMetaResponse, "version">;
  /** Returns a paginated list of sessions for `GET /sessions`. Secret options are automatically redacted by {@link aap | `aap`}. */
  getSessions(params: { after?: string }): Promise<GetSessionsResponse>;
  /** Returns the session object, or `undefined` if not found — {@link aap | `aap`} will respond with 404. Secret options are automatically redacted by {@link aap | `aap`}. */
  getSession(sessionId: string): Promise<T | undefined>;
  /** Returns the session history, or `undefined` if the session does not exist or the history type is not supported — the router will respond with 404. */
  getSessionHistory(sessionId: string, type: HistoryType): Promise<HistoryMessage[] | undefined>;
  /** Creates a new session and returns its ID for `POST /sessions`. */
  postSessions(req: PostSessionsRequest): Promise<PostSessionsResponse>;
  /** Runs a non-streaming agent turn for `POST /sessions/:id/turns` with `stream: "none"`. The session is resolved via `getSession` before this is called — returns 404 if not found. */
  postSessionTurnStreamNone(
    session: T,
    req: PostSessionTurnRequest,
  ): Promise<PostSessionTurnResponse>;
  /** Runs a delta-streaming agent turn for `POST /sessions/:id/turns` with `stream: "delta"`. The session is resolved via `getSession` before this is called — returns 404 if not found. */
  postSessionTurnStreamDelta(
    session: T,
    req: PostSessionTurnRequest,
    onEvent: (event: DeltaSSEEvent) => void,
  ): Promise<void>;
  /** Runs a message-streaming agent turn for `POST /sessions/:id/turns` with `stream: "message"`. The session is resolved via `getSession` before this is called — returns 404 if not found. */
  postSessionTurnStreamMessage(
    session: T,
    req: PostSessionTurnRequest,
    onEvent: (event: MessageSSEEvent) => void,
  ): Promise<void>;
  /** Deletes a session for `DELETE /sessions/:id`. Return `false` if the session was not found — the router will respond with 404. */
  deleteSession(sessionId: string): Promise<boolean>;
}

/**
 * Replaces secret option values in a `SessionInfo` with `"***"`.
 *
 * Use this when implementing `GET /sessions` and `GET /sessions/:id` in a custom
 * AAP server to avoid leaking secret option values in responses.
 * This is applied automatically when using the `aap` Hono app.
 */
export function redactSessionSecrets(session: SessionInfo, agents: AgentInfo[]): SessionInfo {
  const { options } = session.agent;
  if (!options) return session;
  const agentInfo = agents.find((a) => a.name === session.agent.name);
  const secretNames = new Set(
    agentInfo?.options?.filter((o) => o.type === "secret").map((o) => o.name) ?? [],
  );
  if (secretNames.size === 0) return session;
  return {
    ...session,
    agent: {
      ...session.agent,
      options: Object.fromEntries(
        Object.entries(options).map(([k, v]) => [k, secretNames.has(k) ? "***" : v]),
      ),
    },
  };
}

// --- aap ---

/**
 * Returns a Hono app with all AAP endpoints mounted.
 * Use with `app.route()` to compose it into your app, optionally under a base path.
 * Apply auth, CORS, and other middleware to your outer app before routing.
 *
 * @example
 * const app = new Hono()
 * app.use(bearerAuth({ token: 'secret' }))
 * app.route('/', aap(handler))
 *
 * // with base path:
 * app.route('/api/v1', aap(handler))
 */
export function aap<T extends ToSessionInfo>(handler: Handler<T>): Hono {
  const router = new Hono();

  router.get("/meta", (c) =>
    c.json({ version: 3, ...handler.getMeta() } satisfies GetMetaResponse),
  );

  router.post("/sessions", async (c) => {
    const req = await c.req.json<PostSessionsRequest>();
    const result = await handler.postSessions(req);
    return c.json(result as PostSessionsResponse, 201);
  });

  router.post("/sessions/:id/turns", async (c) => {
    const req = await c.req.json<PostSessionTurnRequest>();
    const id = c.req.param("id");
    const session = await handler.getSession(id);
    if (!session) return c.json({ error: "Session not found" }, 404);
    const writeEvent =
      (stream: SSEStreamingApi) =>
      ({ event, ...data }: SSEEvent) =>
        stream.writeSSE({ event, data: JSON.stringify(data) });
    if (req.stream === "delta")
      return streamSSE(c, (stream) =>
        handler.postSessionTurnStreamDelta(session, req, writeEvent(stream)),
      );
    if (req.stream === "message")
      return streamSSE(c, (stream) =>
        handler.postSessionTurnStreamMessage(session, req, writeEvent(stream)),
      );
    return c.json(await handler.postSessionTurnStreamNone(session, req));
  });

  router.get("/sessions/:id", async (c) => {
    const session = await handler.getSession(c.req.param("id"));
    if (!session) return c.json({ error: "Session not found" }, 404);
    const { agents } = handler.getMeta();
    return c.json(redactSessionSecrets(session.toSessionInfo(), agents));
  });

  router.get("/sessions/:id/history", async (c) => {
    const typeParam = c.req.query("type");
    if (typeParam !== "compacted" && typeParam !== "full")
      return c.json({ error: 'type must be "compacted" or "full"' }, 400);
    const messages = await handler.getSessionHistory(c.req.param("id"), typeParam);
    if (!messages) return c.json({ error: "Specified history not found" }, 404);
    return c.json({ history: { [typeParam]: messages } });
  });

  router.get("/sessions", async (c) => {
    const after = c.req.query("after");
    const result = await handler.getSessions({ after });
    const { agents } = handler.getMeta();
    return c.json({
      ...result,
      sessions: result.sessions.map((s) => redactSessionSecrets(s, agents)),
    });
  });

  router.delete("/sessions/:id", async (c) => {
    const found = await handler.deleteSession(c.req.param("id"));
    if (!found) return c.json({ error: "Session not found" }, 404);
    return new Response(null, { status: 204 });
  });

  return router;
}
