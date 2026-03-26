import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import type { SSEStreamingApi } from "hono/streaming";
import {
  AgentResponse,
  CreateSessionRequest,
  MetaResponse,
  SessionListResponse,
  SessionResponse,
  SessionTurnRequest,
  SSEEvent,
} from "./types";

// --- Handler interface ---

export interface ServerHandler {
  getMeta(): Promise<MetaResponse>;
  createSession(req: CreateSessionRequest): Promise<AgentResponse | AsyncIterable<SSEEvent>> | AsyncIterable<SSEEvent>;
  sendTurn(sessionId: string, req: SessionTurnRequest): Promise<AgentResponse | AsyncIterable<SSEEvent>> | AsyncIterable<SSEEvent>;
  getSession(sessionId: string): Promise<SessionResponse>;
  listSessions(params: { after?: string }): Promise<SessionListResponse>;
  deleteSession(sessionId: string): Promise<void>;
}

// --- SSE helper ---

export type { SSEStreamingApi };

export async function writeSSEEvents(
  stream: SSEStreamingApi,
  events: AsyncIterable<SSEEvent>,
): Promise<void> {
  for await (const { event, ...data } of events) {
    await stream.writeSSE({ event, data: JSON.stringify(data) });
  }
}

// --- Server ---

export interface ServerOptions {
  /** Called on every request (except GET /meta) to authenticate. Return false to reject. */
  authenticate?: (apiKey: string) => boolean | Promise<boolean>;
  /** CORS origin(s) to allow. Disabled by default. */
  cors?: string | string[];
  /** Base path to mount all routes under, e.g. "/api/v1". */
  base?: string;
}

export class Server {
  readonly app: Hono;

  constructor(handler: ServerHandler, options: ServerOptions = {}) {
    this.app = new Hono();
    const { authenticate } = options;
    const router = options.base ? this.app.basePath(options.base) : this.app;

    if (options.cors !== undefined) {
      router.use("*", cors({ origin: options.cors }));
    }

    const auth = async (apiKey: string): Promise<boolean> => {
      if (!authenticate) return true;
      return authenticate(apiKey);
    };

    const getApiKey = (authHeader: string | undefined): string =>
      authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";

    // GET /meta — auth optional
    router.get("/meta", async (c) => {
      const meta = await handler.getMeta();
      return c.json(meta);
    });

    // Auth middleware for all other routes
    router.use("*", async (c, next) => {
      const apiKey = getApiKey(c.req.header("Authorization"));
      if (!(await auth(apiKey))) return c.json({ error: "Unauthorized" }, 401);
      return next();
    });

    // PUT /session
    router.put("/session", async (c) => {
      const req = await c.req.json<CreateSessionRequest>();
      const result = await handler.createSession(req);
      if (isAsyncIterable(result)) {
        return streamSSE(c, (stream) => writeSSEEvents(stream, result as AsyncIterable<SSEEvent>));
      }
      return c.json(result as AgentResponse, 201);
    });

    // POST /session/:id
    router.post("/session/:id", async (c) => {
      const req = await c.req.json<SessionTurnRequest>();
      const result = await handler.sendTurn(c.req.param("id"), req);
      if (isAsyncIterable(result)) {
        return streamSSE(c, (stream) => writeSSEEvents(stream, result as AsyncIterable<SSEEvent>));
      }
      return c.json(result as AgentResponse);
    });

    // GET /session/:id
    router.get("/session/:id", async (c) => {
      const session = await handler.getSession(c.req.param("id"));
      return c.json(session);
    });

    // GET /sessions
    router.get("/sessions", async (c) => {
      const after = c.req.query("after");
      const result = await handler.listSessions({ after });
      return c.json(result);
    });

    // DELETE /session/:id
    router.delete("/session/:id", async (c) => {
      await handler.deleteSession(c.req.param("id"));
      return new Response(null, { status: 204 });
    });
  }

  /** Returns the Hono fetch handler, ready to pass to any runtime (Node, Bun, Deno, etc.) */
  fetch = (req: Request): Response | Promise<Response> => this.app.fetch(req);
}

function isAsyncIterable(value: unknown): boolean {
  return value != null && typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function";
}
