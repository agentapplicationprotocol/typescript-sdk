import { describe, it, expect, vi } from "vitest";
import { Server } from "./server";
import type { ServerHandler } from "./server";
import type {
  AgentResponse,
  MetaResponse,
  SessionListResponse,
  SessionResponse,
  SSEEvent,
} from "./types";

const meta: MetaResponse = { version: 1, agents: [] };
const session: SessionResponse = { sessionId: "s1", agent: { name: "a" } };
const agentResponse: AgentResponse = { stopReason: "end_turn", messages: [] };
const sessionList: SessionListResponse = { sessions: ["s1"] };

async function* sseEvents(): AsyncIterable<SSEEvent> {
  yield { event: "turn_start" };
  yield { event: "text", text: "hi" };
  yield { event: "turn_stop", stopReason: "end_turn" };
}

function makeHandler(overrides: Partial<ServerHandler> = {}): ServerHandler {
  return {
    getMeta: vi.fn().mockResolvedValue(meta),
    listSessions: vi.fn().mockResolvedValue(sessionList),
    getSession: vi.fn().mockResolvedValue(session),
    createSession: vi.fn().mockResolvedValue(agentResponse),
    sendTurn: vi.fn().mockResolvedValue(agentResponse),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function req(method: string, path: string, body?: unknown, headers?: Record<string, string>) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe("Server", () => {
  it("GET /meta returns meta", async () => {
    const server = new Server(makeHandler());
    const res = await server.app.fetch(req("GET", "/meta"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(meta);
  });

  it("GET /session/:id returns session", async () => {
    const server = new Server(makeHandler());
    const res = await server.app.fetch(req("GET", "/session/s1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(session);
  });

  it("GET /sessions returns session list", async () => {
    const handler = makeHandler();
    const server = new Server(handler);
    const res = await server.app.fetch(req("GET", "/sessions?after=cursor1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(sessionList);
    expect(handler.listSessions).toHaveBeenCalledWith({ after: "cursor1" });
  });

  it("PUT /session returns 400 if last message is not a user message", async () => {
    const server = new Server(makeHandler());
    const res = await server.app.fetch(
      req("PUT", "/session", {
        agent: { name: "a" },
        messages: [{ role: "assistant", content: "hi" }],
      }),
    );
    expect(res.status).toBe(400);
  });

  it("PUT /session returns 201 with AgentResponse", async () => {
    const server = new Server(makeHandler());
    const res = await server.app.fetch(
      req("PUT", "/session", { agent: { name: "a" }, messages: [{ role: "user", content: "hi" }] }),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(agentResponse);
  });

  it("PUT /session with stream returns SSE", async () => {
    const server = new Server(
      makeHandler({ createSession: vi.fn().mockResolvedValue(sseEvents()) }),
    );
    const res = await server.app.fetch(
      req("PUT", "/session", {
        agent: { name: "a" },
        messages: [{ role: "user", content: "hi" }],
        stream: "message",
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
  });

  it("POST /session/:id returns AgentResponse", async () => {
    const server = new Server(makeHandler());
    const res = await server.app.fetch(
      req("POST", "/session/s1", { messages: [{ role: "user", content: "hi" }] }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(agentResponse);
  });

  it("POST /session/:id with stream returns SSE", async () => {
    const server = new Server(makeHandler({ sendTurn: vi.fn().mockResolvedValue(sseEvents()) }));
    const res = await server.app.fetch(
      req("POST", "/session/s1", { messages: [{ role: "user", content: "hi" }], stream: "delta" }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
  });

  it("DELETE /session/:id returns 204", async () => {
    const server = new Server(makeHandler());
    const res = await server.app.fetch(req("DELETE", "/session/s1"));
    expect(res.status).toBe(204);
  });

  it("authenticate: returns 401 when rejected", async () => {
    const server = new Server(makeHandler(), { authenticate: () => false });
    const res = await server.app.fetch(req("GET", "/meta"));
    expect(res.status).toBe(401);
  });

  it("authenticate: passes apiKey and context", async () => {
    const authenticate = vi.fn().mockReturnValue(true);
    const server = new Server(makeHandler(), { authenticate });
    await server.app.fetch(req("GET", "/meta", undefined, { Authorization: "Bearer mykey" }));
    expect(authenticate).toHaveBeenCalledWith(
      "mykey",
      expect.objectContaining({ req: expect.anything() }),
    );
  });

  it("authenticate: allows per-route logic", async () => {
    const server = new Server(makeHandler(), {
      authenticate: (_, c) => c.req.path === "/meta",
    });
    const metaRes = await server.app.fetch(req("GET", "/meta"));
    expect(metaRes.status).toBe(200);
    const sessRes = await server.app.fetch(req("GET", "/session/s1"));
    expect(sessRes.status).toBe(401);
  });

  it("base path prefixes all routes", async () => {
    const server = new Server(makeHandler(), { base: "/api/v1" });
    const res = await server.app.fetch(req("GET", "/api/v1/meta"));
    expect(res.status).toBe(200);
  });

  it("cors: sets Access-Control-Allow-Origin header", async () => {
    const server = new Server(makeHandler(), { cors: "https://example.com" });
    const res = await server.app.fetch(
      req("GET", "/meta", undefined, { Origin: "https://example.com" }),
    );
    expect(res.headers.get("access-control-allow-origin")).toBe("https://example.com");
  });
});
