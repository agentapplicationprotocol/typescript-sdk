import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client, ClientError } from "../src/client";
import type {
  PostSessionTurnResponse,
  PostSessionsResponse,
  GetMetaResponse,
  GetSessionsResponse,
  SessionInfo,
  SSEEvent,
} from "@agentapplicationprotocol/core";
import { PROTOCOL_VERSION } from "@agentapplicationprotocol/core";

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
      read: async () =>
        i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined },
      releaseLock: vi.fn(),
    }),
  } as unknown as ReadableStream<Uint8Array>;
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    body,
    text: () => Promise.resolve(""),
  });
}

let client: Client;

beforeEach(() => {
  client = new Client({ baseUrl: BASE_URL, apiKey: API_KEY });
});

describe("Client", () => {
  it("strips trailing slash from baseUrl", () => {
    const c = new Client({ baseUrl: BASE_URL + "/", apiKey: API_KEY });
    const fetch = mockFetch({ version: PROTOCOL_VERSION, agents: [] } satisfies GetMetaResponse);
    vi.stubGlobal("fetch", fetch);
    c.getMeta();
    expect(fetch.mock.calls[0][0]).toBe(`${BASE_URL}/meta`);
  });

  it("sends Authorization header", async () => {
    const fetch = mockFetch({ version: PROTOCOL_VERSION, agents: [] } satisfies GetMetaResponse);
    vi.stubGlobal("fetch", fetch);
    await client.getMeta();
    expect(fetch.mock.calls[0][1].headers["Authorization"]).toBe(`Bearer ${API_KEY}`);
  });

  it("getMeta: GET /meta", async () => {
    const meta: GetMetaResponse = { version: PROTOCOL_VERSION, agents: [] };
    vi.stubGlobal("fetch", mockFetch(meta));
    expect(await client.getMeta()).toEqual(meta);
  });

  it("getSession: GET /sessions/:id", async () => {
    const session: SessionInfo = { sessionId: "s1", agent: { name: "a" } };
    vi.stubGlobal("fetch", mockFetch(session));
    expect(await client.getSession("s1")).toEqual(session);
  });

  it("getSessionHistory: appends ?type=compacted", async () => {
    const fetch = mockFetch({ history: { compacted: [] } });
    vi.stubGlobal("fetch", fetch);
    await client.getSessionHistory("s1", "compacted");
    expect(fetch.mock.calls[0][0]).toBe(`${BASE_URL}/sessions/s1/history?type=compacted`);
  });

  it("getSessionHistory: appends ?type=full", async () => {
    const fetch = mockFetch({ history: { full: [] } });
    vi.stubGlobal("fetch", fetch);
    await client.getSessionHistory("s1", "full");
    expect(fetch.mock.calls[0][0]).toBe(`${BASE_URL}/sessions/s1/history?type=full`);
  });

  it("getSessions: GET /sessions without cursor", async () => {
    const res: GetSessionsResponse = { sessions: [{ sessionId: "s1", agent: { name: "a" } }] };
    const fetch = mockFetch(res);
    vi.stubGlobal("fetch", fetch);
    await client.getSessions();
    expect(fetch.mock.calls[0][0]).toBe(`${BASE_URL}/sessions`);
  });

  it("getSessions: appends after param", async () => {
    const fetch = mockFetch({ sessions: [] } satisfies GetSessionsResponse);
    vi.stubGlobal("fetch", fetch);
    await client.getSessions({ after: "cursor1" });
    expect(fetch.mock.calls[0][0]).toBe(`${BASE_URL}/sessions?after=cursor1`);
  });

  it("deleteSession: DELETE /sessions/:id returns void on 204", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 204 }));
    await expect(client.deleteSession("s1")).resolves.toBeUndefined();
  });

  it("postSessions: POST /sessions returns sessionId", async () => {
    const res: PostSessionsResponse = { sessionId: "s1" };
    vi.stubGlobal("fetch", mockFetch(res, 201));
    const result = await client.postSessions({ agent: { name: "a" } });
    expect(result).toEqual(res);
  });

  it("postSessionTurn: non-streaming returns PostSessionTurnResponse", async () => {
    const res: PostSessionTurnResponse = { stopReason: "end_turn", messages: [] };
    vi.stubGlobal("fetch", mockFetch(res));
    const result = await client.postSessionTurn("s1", {
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result).toEqual(res);
  });

  it("postSessionTurn: streaming returns SSE events", async () => {
    const events: SSEEvent[] = [
      { event: "turn_start" },
      { event: "text", text: "hello" },
      { event: "turn_stop", stopReason: "end_turn" },
    ];
    vi.stubGlobal("fetch", mockSSEFetch(events));
    const stream = await client.postSessionTurn("s1", {
      messages: [{ role: "user", content: "hi" }],
      stream: "message",
    });
    const received: SSEEvent[] = [];
    for await (const e of stream!) received.push(e);
    expect(received).toEqual(events);
  });

  it("streamRequest: throws ClientError on non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        body: null,
        text: () => Promise.resolve("Forbidden"),
      }),
    );
    await expect(
      client.postSessionTurn("s1", {
        messages: [{ role: "user", content: "hi" }],
        stream: "delta",
      }),
    ).rejects.toThrow(ClientError);
  });

  it("throws ClientError on non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({ ok: false, status: 401, text: () => Promise.resolve("Unauthorized") }),
    );
    await expect(client.getMeta()).rejects.toThrow(ClientError);
  });

  it("ClientError has correct properties", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve("Server Error") }),
    );
    const err = await client.getSession("x").catch((e) => e);
    expect(err).toBeInstanceOf(ClientError);
    expect(err.status).toBe(500);
    expect(err.method).toBe("GET");
    expect(err.path).toBe("/sessions/x");
  });

  it("getMeta: throws on version mismatch", async () => {
    vi.stubGlobal("fetch", mockFetch({ version: 2, agents: [] }));
    await expect(client.getMeta()).rejects.toThrow("Protocol version mismatch");
  });
});
