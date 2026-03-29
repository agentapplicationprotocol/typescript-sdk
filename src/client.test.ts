import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client, ClientError } from "./client";
import type { AgentResponse, MetaResponse, SessionListResponse, SessionResponse, SSEEvent } from "./types";

const BASE_URL = "https://example.com";
const API_KEY = "test-key";

function mockFetch(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: "OK",
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(String(body)),
    body: null,
  });
}

function mockSSEFetch(events: SSEEvent[], status = 200) {
  const chunks = events.map(({ event, ...data }) =>
    new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
  );
  let i = 0;
  const body = {
    getReader: () => ({
      read: async () => i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined },
      releaseLock: vi.fn(),
    }),
  } as unknown as ReadableStream<Uint8Array>;
  return vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, body, text: () => Promise.resolve("") });
}

let client: Client;

beforeEach(() => {
  client = new Client({ baseUrl: BASE_URL, apiKey: API_KEY });
});

describe("Client", () => {
  it("strips trailing slash from baseUrl", () => {
    const c = new Client({ baseUrl: BASE_URL + "/", apiKey: API_KEY });
    const fetch = mockFetch({});
    vi.stubGlobal("fetch", fetch);
    c.getMeta();
    expect(fetch.mock.calls[0][0]).toBe(`${BASE_URL}/meta`);
  });

  it("sends Authorization header", async () => {
    const fetch = mockFetch({ version: 1, agents: [] } satisfies MetaResponse);
    vi.stubGlobal("fetch", fetch);
    await client.getMeta();
    expect(fetch.mock.calls[0][1].headers["Authorization"]).toBe(`Bearer ${API_KEY}`);
  });

  it("getMeta: GET /meta", async () => {
    const meta: MetaResponse = { version: 1, agents: [] };
    vi.stubGlobal("fetch", mockFetch(meta));
    expect(await client.getMeta()).toEqual(meta);
  });

  it("getSession: GET /session/:id", async () => {
    const session: SessionResponse = { sessionId: "s1", agent: { name: "a" } };
    vi.stubGlobal("fetch", mockFetch(session));
    expect(await client.getSession("s1")).toEqual(session);
  });

  it("listSessions: GET /sessions without cursor", async () => {
    const res: SessionListResponse = { sessions: ["s1"] };
    const fetch = mockFetch(res);
    vi.stubGlobal("fetch", fetch);
    await client.listSessions();
    expect(fetch.mock.calls[0][0]).toBe(`${BASE_URL}/sessions`);
  });

  it("listSessions: appends after param", async () => {
    const fetch = mockFetch({ sessions: [] } satisfies SessionListResponse);
    vi.stubGlobal("fetch", fetch);
    await client.listSessions({ after: "cursor1" });
    expect(fetch.mock.calls[0][0]).toBe(`${BASE_URL}/sessions?after=cursor1`);
  });

  it("listAllSessions: paginates until no next", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ sessions: ["s1"], next: "c1" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ sessions: ["s2"] }) });
    vi.stubGlobal("fetch", fetch);
    expect(await client.listAllSessions()).toEqual(["s1", "s2"]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("deleteSession: DELETE /session/:id returns void on 204", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 204 }));
    await expect(client.deleteSession("s1")).resolves.toBeUndefined();
  });

  it("createSession: non-streaming returns AgentResponse", async () => {
    const res: AgentResponse = { sessionId: "s1", stopReason: "end_turn", messages: [] };
    vi.stubGlobal("fetch", mockFetch(res, 201));
    const result = await client.createSession({ agent: { name: "a" }, messages: [{ role: "user", content: "hi" }] });
    expect(result).toEqual(res);
  });

  it("createSession: streaming returns SSE events", async () => {
    const events: SSEEvent[] = [
      { event: "session_start", sessionId: "s1" },
      { event: "turn_start" },
      { event: "turn_stop", stopReason: "end_turn" },
    ];
    vi.stubGlobal("fetch", mockSSEFetch(events));
    const stream = await client.createSession({ agent: { name: "a" }, messages: [{ role: "user", content: "hi" }], stream: "message" });
    const received: SSEEvent[] = [];
    for await (const e of stream) received.push(e);
    expect(received).toEqual(events);
  });

  it("sendTurn: non-streaming returns AgentResponse", async () => {
    const res: AgentResponse = { stopReason: "end_turn", messages: [] };
    vi.stubGlobal("fetch", mockFetch(res));
    const result = await client.sendTurn("s1", { messages: [{ role: "user", content: "hi" }] });
    expect(result).toEqual(res);
  });

  it("sendTurn: streaming returns SSE events", async () => {
    const events: SSEEvent[] = [
      { event: "turn_start" },
      { event: "text", text: "hello" },
      { event: "turn_stop", stopReason: "end_turn" },
    ];
    vi.stubGlobal("fetch", mockSSEFetch(events));
    const stream = await client.sendTurn("s1", { messages: [{ role: "user", content: "hi" }], stream: "message" });
    const received: SSEEvent[] = [];
    for await (const e of stream) received.push(e);
    expect(received).toEqual(events);
  });

  it("streamRequest: throws ClientError on non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403, body: null, text: () => Promise.resolve("Forbidden") }));
    await expect(client.createSession({ agent: { name: "a" }, messages: [{ role: "user", content: "hi" }], stream: "delta" })).rejects.toThrow(ClientError);
  });

  it("throws ClientError on non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, text: () => Promise.resolve("Unauthorized") }));
    await expect(client.getMeta()).rejects.toThrow(ClientError);
  });

  it("ClientError has correct properties", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404, text: () => Promise.resolve("Not Found") }));
    const err = await client.getSession("x").catch((e) => e);
    expect(err).toBeInstanceOf(ClientError);
    expect(err.status).toBe(404);
    expect(err.method).toBe("GET");
    expect(err.path).toBe("/session/x");
  });
});
