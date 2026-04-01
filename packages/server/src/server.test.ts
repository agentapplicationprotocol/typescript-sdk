import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { cors } from "hono/cors";
import { aap } from "./server";
import type { Handler } from "./server";
import type {
  AgentResponse,
  MetaResponse,
  SessionListResponse,
  SessionResponse,
  SSEEvent,
} from "@agentapplicationprotocol/core";

const meta: MetaResponse = { version: 1, agents: [] };
const session: SessionResponse = { sessionId: "s1", agent: { name: "a" } };
const agentResponse: AgentResponse = { stopReason: "end_turn", messages: [] };
const createSessionResponse = { ...agentResponse, sessionId: "s1" };
const sessionList: SessionListResponse = { sessions: ["s1"] };

async function* sseEvents(): AsyncIterable<SSEEvent> {
  yield { event: "turn_start" };
  yield { event: "text", text: "hi" };
  yield { event: "turn_stop", stopReason: "end_turn" };
}

function makeHandler(overrides: Partial<Handler> = {}): Handler {
  return {
    getMeta: vi.fn().mockReturnValue(meta),
    listSessions: vi.fn().mockResolvedValue(sessionList),
    getSession: vi.fn().mockResolvedValue(session),
    createSession: vi.fn().mockResolvedValue(createSessionResponse),
    sendTurn: vi.fn().mockResolvedValue(agentResponse),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeApp(handler: Handler, setup?: (app: Hono) => void): Hono {
  const app = new Hono();
  setup?.(app);
  app.route("/", aap(handler));
  return app;
}

function req(method: string, path: string, body?: unknown, headers?: Record<string, string>) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe("aap middleware", () => {
  it("GET /meta returns meta", async () => {
    const app = makeApp(makeHandler());
    const res = await app.fetch(req("GET", "/meta"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(meta);
  });

  it("GET /session/:id returns session", async () => {
    const app = makeApp(makeHandler());
    const res = await app.fetch(req("GET", "/session/s1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(session);
  });

  it("GET /session/:id redacts secret options", async () => {
    const secretSession: SessionResponse = {
      sessionId: "s1",
      agent: { name: "a", options: { key: "mysecret", model: "gpt-4" } },
    };
    const secretMeta: MetaResponse = {
      version: 1,
      agents: [
        {
          name: "a",
          version: "1.0.0",
          options: [
            { type: "secret", name: "key", default: "" },
            { type: "text", name: "model", default: "" },
          ],
        },
      ],
    };
    const app = makeApp(
      makeHandler({
        getSession: vi.fn().mockResolvedValue(secretSession),
        getMeta: vi.fn().mockReturnValue(secretMeta),
      }),
    );
    const res = await app.fetch(req("GET", "/session/s1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ...secretSession,
      agent: { ...secretSession.agent, options: { key: "***", model: "gpt-4" } },
    });
  });

  it("GET /sessions returns session list", async () => {
    const handler = makeHandler();
    const app = makeApp(handler);
    const res = await app.fetch(req("GET", "/sessions?after=cursor1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(sessionList);
    expect(handler.listSessions).toHaveBeenCalledWith({ after: "cursor1" });
  });

  it("PUT /session returns 400 if last message is not a user message", async () => {
    const app = makeApp(makeHandler());
    const res = await app.fetch(
      req("PUT", "/session", {
        agent: { name: "a" },
        messages: [{ role: "assistant", content: "hi" }],
      }),
    );
    expect(res.status).toBe(400);
  });

  it("PUT /session returns 201 with AgentResponse", async () => {
    const app = makeApp(makeHandler());
    const res = await app.fetch(
      req("PUT", "/session", { agent: { name: "a" }, messages: [{ role: "user", content: "hi" }] }),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(createSessionResponse);
  });

  it("PUT /session with stream returns SSE", async () => {
    const app = makeApp(makeHandler({ createSession: vi.fn().mockResolvedValue(sseEvents()) }));
    const res = await app.fetch(
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
    const app = makeApp(makeHandler());
    const res = await app.fetch(
      req("POST", "/session/s1", { messages: [{ role: "user", content: "hi" }] }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(agentResponse);
  });

  it("POST /session/:id with stream returns SSE", async () => {
    const app = makeApp(makeHandler({ sendTurn: vi.fn().mockResolvedValue(sseEvents()) }));
    const res = await app.fetch(
      req("POST", "/session/s1", { messages: [{ role: "user", content: "hi" }], stream: "delta" }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
  });

  it("DELETE /session/:id returns 204", async () => {
    const app = makeApp(makeHandler());
    const res = await app.fetch(req("DELETE", "/session/s1"));
    expect(res.status).toBe(204);
  });

  it("auth middleware: returns 401 when rejected", async () => {
    const app = makeApp(makeHandler(), (a) => a.use(bearerAuth({ token: "secret" })));
    const res = await app.fetch(req("GET", "/meta"));
    expect(res.status).toBe(401);
  });

  it("auth middleware: passes with valid token", async () => {
    const app = makeApp(makeHandler(), (a) => a.use(bearerAuth({ token: "secret" })));
    const res = await app.fetch(req("GET", "/meta", undefined, { Authorization: "Bearer secret" }));
    expect(res.status).toBe(200);
  });

  it("base path: mounts under sub-router", async () => {
    const app = new Hono();
    app.route("/api/v1", aap(makeHandler()));
    const res = await app.fetch(req("GET", "/api/v1/meta"));
    expect(res.status).toBe(200);
  });

  it("cors: sets Access-Control-Allow-Origin header", async () => {
    const app = makeApp(makeHandler(), (a) => a.use(cors({ origin: "https://example.com" })));
    const res = await app.fetch(req("GET", "/meta", undefined, { Origin: "https://example.com" }));
    expect(res.headers.get("access-control-allow-origin")).toBe("https://example.com");
  });

  it("GET /session/:id does not redact when agent not found in meta", async () => {
    const sessionWithOptions: SessionResponse = {
      sessionId: "s1",
      agent: { name: "unknown", options: { key: "secret" } },
    };
    const app = makeApp(
      makeHandler({
        getSession: vi.fn().mockResolvedValue(sessionWithOptions),
        getMeta: vi.fn().mockReturnValue({ version: 1, agents: [] }),
      }),
    );
    const res = await app.fetch(req("GET", "/session/s1"));
    expect(await res.json()).toEqual(sessionWithOptions);
  });

  it("GET /session/:id does not redact when agent has no secret options", async () => {
    const sessionWithOptions: SessionResponse = {
      sessionId: "s1",
      agent: { name: "a", options: { model: "gpt-4" } },
    };
    const app = makeApp(
      makeHandler({
        getSession: vi.fn().mockResolvedValue(sessionWithOptions),
        getMeta: vi.fn().mockReturnValue({
          version: 1,
          agents: [
            {
              name: "a",
              version: "1.0.0",
              options: [{ type: "text", name: "model", default: "" }],
            },
          ],
        }),
      }),
    );
    const res = await app.fetch(req("GET", "/session/s1"));
    expect(await res.json()).toEqual(sessionWithOptions);
  });

  it("GET /session/:id?history=compacted passes param and strips full", async () => {
    const handler = makeHandler({
      getSession: vi.fn().mockResolvedValue({
        ...session,
        history: { compacted: [], full: [] },
      }),
    });
    const app = makeApp(handler);
    const res = await app.fetch(req("GET", "/session/s1?history=compacted"));
    expect(handler.getSession).toHaveBeenCalledWith("s1", "compacted");
    expect(await res.json()).toEqual({ ...session, history: { compacted: [] } });
  });

  it("GET /session/:id?history=full passes param and strips compacted", async () => {
    const handler = makeHandler({
      getSession: vi.fn().mockResolvedValue({
        ...session,
        history: { compacted: [], full: [] },
      }),
    });
    const app = makeApp(handler);
    const res = await app.fetch(req("GET", "/session/s1?history=full"));
    expect(handler.getSession).toHaveBeenCalledWith("s1", "full");
    expect(await res.json()).toEqual({ ...session, history: { full: [] } });
  });

  it("GET /session/:id without ?history passes undefined and strips history from response", async () => {
    const handler = makeHandler({
      getSession: vi.fn().mockResolvedValue({
        ...session,
        history: { compacted: [], full: [] },
      }),
    });
    const app = makeApp(handler);
    const res = await app.fetch(req("GET", "/session/s1"));
    expect(handler.getSession).toHaveBeenCalledWith("s1", undefined);
    expect(await res.json()).toEqual(session);
  });

  it("GET /session/:id with invalid ?history passes undefined", async () => {
    const handler = makeHandler();
    const app = makeApp(handler);
    await app.fetch(req("GET", "/session/s1?history=invalid"));
    expect(handler.getSession).toHaveBeenCalledWith("s1", undefined);
  });
});
