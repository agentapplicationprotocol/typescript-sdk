import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client } from "../src/client";
import { Session } from "../src/session";
import type {
  AgentInfo,
  PostSessionTurnResponse,
  PostSessionsResponse,
  SessionInfo,
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
  const sessionRes: SessionInfo = { sessionId: "s1", agent: { name: "test-agent" } };

  it("returns session with correct sessionId and agentConfig", async () => {
    const { session } = await Session.load(client, sessionRes, agentInfo);
    expect(session.sessionId).toBe("s1");
    expect(session.agentConfig).toEqual({ name: "test-agent" });
    expect(session.agent).toBe(agentInfo);
  });

  it("populates history from full history", async () => {
    const history = [{ role: "user" as const, content: "hi" }];
    vi.stubGlobal("fetch", mockFetch({ history: { full: history } }));
    const { session } = await Session.load(client, sessionRes, agentInfo, "full");
    expect(session.history).toEqual(history);
  });

  it("populates history from compacted history", async () => {
    const history = [{ role: "user" as const, content: "summary" }];
    vi.stubGlobal("fetch", mockFetch({ history: { compacted: history } }));
    const { session } = await Session.load(client, sessionRes, agentInfo, "compacted");
    expect(session.history).toEqual(history);
  });

  it("returns empty history when no history in response", async () => {
    vi.stubGlobal("fetch", mockFetch({ history: {} }));
    const { session } = await Session.load(client, sessionRes, agentInfo, "full");
    expect(session.history).toEqual([]);
  });

  it("resolves pending client tool use from history", async () => {
    const tools = [
      {
        name: "myTool",
        description: "d",
        parameters: { type: "object" as const, properties: {} },
      },
    ];
    const history = [
      { role: "user" as const, content: "go" },
      {
        role: "assistant" as const,
        content: [{ type: "tool_use" as const, toolCallId: "tc1", name: "myTool", input: {} }],
      },
    ];
    vi.stubGlobal("fetch", mockFetch({ history: { full: history } }));
    const res: SessionInfo = { sessionId: "s1", agent: { name: "test-agent" }, tools };
    const { pending } = await Session.load(client, res, agentInfo, "full");
    expect(pending.client).toEqual([{ toolCallId: "tc1", name: "myTool", input: {} }]);
    expect(pending.server).toEqual([]);
  });

  it("calls getSessionHistory with correct type param", async () => {
    const fetch = mockFetch({ history: { compacted: [] } });
    vi.stubGlobal("fetch", fetch);
    await Session.load(client, sessionRes, agentInfo, "compacted");
    expect(fetch.mock.calls[0][0]).toBe(`${BASE_URL}/sessions/s1/history?type=compacted`);
  });

  it("does not fetch when no history requested", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await Session.load(client, sessionRes, agentInfo);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("Session.create", () => {
  it("creates session and seeds history from messages", async () => {
    const createRes: PostSessionsResponse = { sessionId: "s1" };
    vi.stubGlobal("fetch", mockFetch(createRes, 201));
    const session = await Session.create(
      client,
      {
        agent: { name: "test-agent" },
        messages: [{ role: "system", content: "You are helpful." }],
      },
      agentInfo,
    );
    expect(session.sessionId).toBe("s1");
    expect(session.history).toEqual([{ role: "system", content: "You are helpful." }]);
  });

  it("creates session with empty history when no messages", async () => {
    const createRes: PostSessionsResponse = { sessionId: "s1" };
    vi.stubGlobal("fetch", mockFetch(createRes, 201));
    const session = await Session.create(client, { agent: { name: "test-agent" } }, agentInfo);
    expect(session.history).toEqual([]);
  });
});

describe("Session.send", () => {
  async function makeSession() {
    const createRes: PostSessionsResponse = { sessionId: "s1" };
    vi.stubGlobal("fetch", mockFetch(createRes, 201));
    return Session.create(client, { agent: { name: "test-agent" } }, agentInfo);
  }

  it("non-streaming: appends messages and returns pending", async () => {
    const session = await makeSession();
    const turnRes: PostSessionTurnResponse = {
      stopReason: "end_turn",
      messages: [{ role: "assistant", content: "reply" }],
    };
    vi.stubGlobal("fetch", mockFetch(turnRes));
    const { pending } = await session.send({ messages: [{ role: "user", content: "next" }] });
    expect(session.history).toHaveLength(2);
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
      { name: "t", description: "d", parameters: { type: "object" as const, properties: {} } },
    ];
    session.tools = tools;
    const fetch = mockFetch({
      stopReason: "end_turn",
      messages: [],
    } satisfies PostSessionTurnResponse);
    vi.stubGlobal("fetch", fetch);
    await session.send({ messages: [{ role: "user", content: "hi" }], tools });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.tools).toBeUndefined();
  });

  it("sends changed tools and updates session.tools", async () => {
    const session = await makeSession();
    const newTools = [
      { name: "t2", description: "d", parameters: { type: "object" as const, properties: {} } },
    ];
    const fetch = mockFetch({
      stopReason: "end_turn",
      messages: [],
    } satisfies PostSessionTurnResponse);
    vi.stubGlobal("fetch", fetch);
    await session.send({ messages: [{ role: "user", content: "hi" }], tools: newTools });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.tools).toEqual(newTools);
    expect(session.tools).toEqual(newTools);
  });

  it("sends only changed agent options", async () => {
    const session = await makeSession();
    session.agentConfig = { name: "test-agent", options: { model: "gpt-4" } };
    const fetch = mockFetch({
      stopReason: "end_turn",
      messages: [],
    } satisfies PostSessionTurnResponse);
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
    const fetch = mockFetch({
      stopReason: "end_turn",
      messages: [],
    } satisfies PostSessionTurnResponse);
    vi.stubGlobal("fetch", fetch);
    await session.send({ messages: [{ role: "user", content: "hi" }] });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.agent).toBeUndefined();
  });

  it("omits agent.tools if unchanged", async () => {
    const session = await makeSession();
    const tools = [{ name: "echo", trust: true }];
    session.agentConfig = { name: "test-agent", tools };
    const fetch = mockFetch({
      stopReason: "end_turn",
      messages: [],
    } satisfies PostSessionTurnResponse);
    vi.stubGlobal("fetch", fetch);
    await session.send({ messages: [{ role: "user", content: "hi" }], agent: { tools } });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.agent).toBeUndefined();
  });

  it("updates agentConfig.tools when changed", async () => {
    const session = await makeSession();
    const newTools = [{ name: "echo", trust: true }];
    vi.stubGlobal(
      "fetch",
      mockFetch({ stopReason: "end_turn", messages: [] } satisfies PostSessionTurnResponse),
    );
    await session.send({ messages: [{ role: "user", content: "hi" }], agent: { tools: newTools } });
    expect(session.agentConfig.tools).toEqual(newTools);
  });

  it("updates agentConfig.options when changed", async () => {
    const session = await makeSession();
    session.agentConfig = { name: "test-agent", options: { model: "gpt-4" } };
    vi.stubGlobal(
      "fetch",
      mockFetch({ stopReason: "end_turn", messages: [] } satisfies PostSessionTurnResponse),
    );
    await session.send({
      messages: [{ role: "user", content: "hi" }],
      agent: { options: { model: "gpt-4o" } },
    });
    expect(session.agentConfig.options).toEqual({ model: "gpt-4o" });
  });
});
