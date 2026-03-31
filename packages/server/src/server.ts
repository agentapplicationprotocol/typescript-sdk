import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { SSEStreamingApi } from "hono/streaming";
import {
  AgentInfo,
  AgentResponse,
  CreateSessionRequest,
  CreateSessionResponse,
  MetaResponse,
  SessionListResponse,
  SessionResponse,
  SessionTurnRequest,
  SSEEvent,
} from "@agentapplicationprotocol/core";

// --- Handler interface ---

export interface ServerHandler {
  getMeta(): MetaResponse;
  listSessions(params: { after?: string }): Promise<SessionListResponse>;
  getSession(sessionId: string): Promise<SessionResponse>;
  /** The last message in `req.messages` is guaranteed to be a user message. */
  createSession(
    req: CreateSessionRequest,
  ): Promise<CreateSessionResponse> | AsyncIterable<SSEEvent>;
  sendTurn(
    sessionId: string,
    req: SessionTurnRequest,
  ): Promise<AgentResponse> | AsyncIterable<SSEEvent>;
  deleteSession(sessionId: string): Promise<void>;
}

// --- SSE helper ---

async function writeSSEEvents(
  stream: SSEStreamingApi,
  events: AsyncIterable<SSEEvent>,
): Promise<void> {
  for await (const { event, ...data } of events) {
    await stream.writeSSE({ event, data: JSON.stringify(data) });
  }
}

function redactSecretOptions(session: SessionResponse, agents: AgentInfo[]): SessionResponse {
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
export function aap(handler: ServerHandler): Hono {
  const router = new Hono();

  router.get("/meta", (c) => c.json(handler.getMeta()));

  router.put("/session", async (c) => {
    const req = await c.req.json<CreateSessionRequest>();
    if (req.messages.at(-1)?.role !== "user")
      return c.json({ error: "Last message must be a user message" }, 400);
    const result = await handler.createSession(req);
    if (req.stream === "delta" || req.stream === "message") {
      return streamSSE(c, (stream) => writeSSEEvents(stream, result as AsyncIterable<SSEEvent>));
    }
    return c.json(result as CreateSessionResponse, 201);
  });

  router.post("/session/:id", async (c) => {
    const req = await c.req.json<SessionTurnRequest>();
    const result = await handler.sendTurn(c.req.param("id"), req);
    if (req.stream === "delta" || req.stream === "message") {
      return streamSSE(c, (stream) => writeSSEEvents(stream, result as AsyncIterable<SSEEvent>));
    }
    return c.json(result as AgentResponse);
  });

  router.get("/session/:id", async (c) => {
    const session = await handler.getSession(c.req.param("id"));
    const meta = handler.getMeta();
    return c.json(redactSecretOptions(session, meta.agents));
  });

  router.get("/sessions", async (c) => {
    const after = c.req.query("after");
    return c.json(await handler.listSessions({ after }));
  });

  router.delete("/session/:id", async (c) => {
    await handler.deleteSession(c.req.param("id"));
    return new Response(null, { status: 204 });
  });

  return router;
}
