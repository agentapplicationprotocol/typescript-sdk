import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client } from "./client";
import { Session } from "./session";
import type {
  AgentInfo,
  AgentResponse,
  CreateSessionResponse,
  SessionResponse,
  SSEEvent,
} from "@agentapplicationprotocol/core";

const BASE_URL = "https://example.com";
const agentInfo: AgentInfo = { name: "test-agent", version: "1.0.0" };

function mockFetch(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(String(body)),
    body: null,
  });
}

function mockSSEFetch(events: SSEEvent[]) {
  const chunks = events.map(({ event, ...data }) =>
    new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
  );
  let i = 0;
  const body = {
    getReader: () => ({
      read: async () =>
        i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined },
      releaseLock: vi.fn(),
    }),
  } as unknown as ReadableStream<Uint8Array>;
  return vi
    .fn()
    .mockResolvedValue({ ok: true, status: 200, body, text: () => Promise.resolve("") });
}

let client: Client;

beforeEach(() => {
  client = new Client({ baseUrl: BASE_URL, apiKey: "key" });
});

describe("Session.load", () => {
  it("returns session with correct sessionId and agentConfig", async () => {
    const res: SessionResponse = { sessionId: "s1", agent: { name: "test-agent" } };
    vi.stubGlobal("fetch", mockFetch(res));
    const { session } = await Session.load(client, "s1", [agentInfo]);
    expect(session.sessionId).toBe("s1");
    expect(session.agentConfig).toEqual({ name: "test-agent" });
    expect(session.agent).toBe(agentInfo);
  });

  it("populates history from full history", async () => {
    const history = [{ role: "user" as const, content: "hi" }];
    const res: SessionResponse = {
      sessionId: "s1",
      agent: { name: "test-agent" },
      history: { full: history },
    };
    vi.stubGlobal("fetch", mockFetch(res));
    const { session } = await Session.load(client, "s1", [agentInfo], "full");
    expect(session.history).toEqual(history);
  });

  it("populates history from compacted history", async () => {
    const history = [{ role: "user" as const, content: "summary" }];
    const res: SessionResponse = {
      sessionId: "s1",
      agent: { name: "test-agent" },
      history: { compacted: history },
    };
    vi.stubGlobal("fetch", mockFetch(res));
    const { session } = await Session.load(client, "s1", [agentInfo], "compacted");
    expect(session.history).toEqual(history);
  });

  it("returns empty history when no history in response", async () => {
    const res: SessionResponse = { sessionId: "s1", agent: { name: "test-agent" } };
    vi.stubGlobal("fetch", mockFetch(res));
    const { session } = await Session.load(client, "s1", [agentInfo], "full");
    expect(session.history).toEqual([]);
  });

  it("resolves pending client tool use from history", async () => {
    const tools = [
      {
        name: "myTool",
        description: "d",
        inputSchema: { type: "object" as const, properties: {} },
      },
    ];
    const history = [
      { role: "user" as const, content: "go" },
      {
        role: "assistant" as const,
        content: [{ type: "tool_use" as const, toolCallId: "tc1", name: "myTool", input: {} }],
      },
    ];
    const res: SessionResponse = {
      sessionId: "s1",
      agent: { name: "test-agent" },
      tools,
      history: { full: history },
    };
    vi.stubGlobal("fetch", mockFetch(res));
    const { pending } = await Session.load(client, "s1", [agentInfo], "full");
    expect(pending.client).toEqual([{ toolCallId: "tc1", name: "myTool", input: {} }]);
    expect(pending.server).toEqual([]);
  });

  it("calls getSession with correct history param", async () => {
    const fetch = mockFetch({
      sessionId: "s1",
      agent: { name: "test-agent" },
    } satisfies SessionResponse);
    vi.stubGlobal("fetch", fetch);
    await Session.load(client, "s1", [agentInfo], "compacted");
    expect(fetch.mock.calls[0][0]).toBe(`${BASE_URL}/session/s1?history=compacted`);
  });

  it("throws if agent name not found in list", async () => {
    const res: SessionResponse = { sessionId: "s1", agent: { name: "unknown-agent" } };
    vi.stubGlobal("fetch", mockFetch(res));
    await expect(Session.load(client, "s1", [agentInfo])).rejects.toThrow(
      "Unknown agent: unknown-agent",
    );
  });
});

describe("Session.create", () => {
  it("non-streaming: builds session and history", async () => {
    const res: CreateSessionResponse = {
      sessionId: "s1",
      stopReason: "end_turn",
      messages: [{ role: "assistant", content: "hi" }],
    };
    vi.stubGlobal("fetch", mockFetch(res, 201));
    const { session, pending } = await Session.create(
      client,
      { agent: { name: "test-agent" }, messages: [{ role: "user", content: "hello" }] },
      agentInfo,
    );
    expect(session.sessionId).toBe("s1");
    expect(session.history).toHaveLength(2);
    expect(pending).toEqual({ client: [], server: [] });
  });

  it("streaming: builds session from SSE events and calls cb", async () => {
    const events: SSEEvent[] = [
      { event: "session_start", sessionId: "s2" },
      { event: "turn_start" },
      { event: "text", text: "hey" },
      { event: "turn_stop", stopReason: "end_turn" },
    ];
    vi.stubGlobal("fetch", mockSSEFetch(events));
    const cb = vi.fn();
    const { session } = await Session.create(
      client,
      {
        agent: { name: "test-agent" },
        messages: [{ role: "user", content: "hello" }],
        stream: "message",
      },
      agentInfo,
      cb,
    );
    expect(session.sessionId).toBe("s2");
    expect(cb).toHaveBeenCalledTimes(events.length);
  });
});

describe("Session.send", () => {
  async function makeSession() {
    const res: CreateSessionResponse = { sessionId: "s1", stopReason: "end_turn", messages: [] };
    vi.stubGlobal("fetch", mockFetch(res, 201));
    const { session } = await Session.create(
      client,
      { agent: { name: "test-agent" }, messages: [{ role: "user", content: "hi" }] },
      agentInfo,
    );
    return session;
  }

  it("non-streaming: appends messages and returns pending", async () => {
    const session = await makeSession();
    const turnRes: AgentResponse = {
      stopReason: "end_turn",
      messages: [{ role: "assistant", content: "reply" }],
    };
    vi.stubGlobal("fetch", mockFetch(turnRes));
    const pending = await session.send({ messages: [{ role: "user", content: "next" }] });
    expect(session.history).toHaveLength(3);
    expect(pending).toEqual({ client: [], server: [] });
  });

  it("streaming: appends messages and calls cb", async () => {
    const session = await makeSession();
    const events: SSEEvent[] = [
      { event: "turn_start" },
      { event: "text", text: "streamed" },
      { event: "turn_stop", stopReason: "end_turn" },
    ];
    vi.stubGlobal("fetch", mockSSEFetch(events));
    const cb = vi.fn();
    await session.send({ messages: [{ role: "user", content: "next" }], stream: "message" }, cb);
    expect(cb).toHaveBeenCalledTimes(events.length);
  });

  it("strips unchanged tools from request", async () => {
    const session = await makeSession();
    const tools = [
      { name: "t", description: "d", inputSchema: { type: "object" as const, properties: {} } },
    ];
    session.tools = tools;
    const fetch = mockFetch({ stopReason: "end_turn", messages: [] } satisfies AgentResponse);
    vi.stubGlobal("fetch", fetch);
    await session.send({ messages: [{ role: "user", content: "hi" }], tools });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.tools).toBeUndefined();
  });

  it("sends changed tools and updates session.tools", async () => {
    const session = await makeSession();
    const newTools = [
      { name: "t2", description: "d", inputSchema: { type: "object" as const, properties: {} } },
    ];
    const fetch = mockFetch({ stopReason: "end_turn", messages: [] } satisfies AgentResponse);
    vi.stubGlobal("fetch", fetch);
    await session.send({ messages: [{ role: "user", content: "hi" }], tools: newTools });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.tools).toEqual(newTools);
    expect(session.tools).toEqual(newTools);
  });

  it("sends only changed agent options", async () => {
    const session = await makeSession();
    session.agentConfig = { name: "test-agent", options: { model: "gpt-4" } };
    const fetch = mockFetch({ stopReason: "end_turn", messages: [] } satisfies AgentResponse);
    vi.stubGlobal("fetch", fetch);
    await session.send({
      messages: [{ role: "user", content: "hi" }],
      agent: { options: { model: "gpt-4o", temperature: "0.5" } },
    });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.agent.options).toEqual({ model: "gpt-4o", temperature: "0.5" });
  });

  it("omits agent if nothing changed", async () => {
    const session = await makeSession();
    const fetch = mockFetch({ stopReason: "end_turn", messages: [] } satisfies AgentResponse);
    vi.stubGlobal("fetch", fetch);
    await session.send({ messages: [{ role: "user", content: "hi" }] });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.agent).toBeUndefined();
  });
});
