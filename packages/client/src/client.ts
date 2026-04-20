import { createParser } from "eventsource-parser";
import {
  PostSessionTurnResponse,
  CreateSessionRequest,
  PostSessionsResponse,
  HistoryType,
  GetMetaResponse,
  GetSessionHistoryResponse,
  GetSessionsResponse,
  SessionInfo,
  SessionTurnRequest,
  SSEEvent,
} from "@agentapplicationprotocol/core";

export interface ClientOptions {
  baseUrl: string;
  apiKey: string;
}

export class ClientError extends Error {
  constructor(
    public readonly method: string,
    public readonly path: string,
    public readonly status: number,
    message: string,
  ) {
    super(`AAP ${method} ${path} → ${status}: ${message}`);
    this.name = "ClientError";
  }
}

export class Client {
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor({ baseUrl, apiKey }: ClientOptions) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    };
  }

  private url(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.url(path), {
      method,
      headers: this.headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new ClientError(method, path, res.status, text);
    }
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  private async streamRequest(
    method: string,
    path: string,
    body: unknown,
  ): Promise<AsyncIterable<SSEEvent>> {
    const res = await fetch(this.url(path), {
      method,
      headers: { ...this.headers, Accept: "text/event-stream" },
      body: JSON.stringify(body),
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => res.statusText);
      throw new ClientError(method, path, res.status, text);
    }
    return parseSSE(res.body);
  }

  /** GET /meta */
  async getMeta(): Promise<GetMetaResponse> {
    const meta = await this.request<GetMetaResponse>("GET", "/meta");
    if (meta.version !== 3) {
      throw new Error(`Protocol version mismatch: expected 3, got ${meta.version}`);
    }
    return meta;
  }

  /** GET /sessions */
  listSessions(params?: { after?: string }): Promise<GetSessionsResponse> {
    let path = "/sessions";
    if (params?.after) {
      path += "?" + new URLSearchParams({ after: params.after }).toString();
    }
    return this.request("GET", path);
  }

  /** Fetches all sessions across all pages. */
  async listAllSessions(): Promise<SessionInfo[]> {
    const sessions: SessionInfo[] = [];
    let after: string | undefined;
    do {
      const res = await this.listSessions({ after });
      sessions.push(...res.sessions);
      after = res.next;
    } while (after);
    return sessions;
  }

  /** GET /sessions/:id */
  getSession(sessionId: string): Promise<SessionInfo> {
    return this.request("GET", `/sessions/${sessionId}`);
  }

  /** GET /sessions/:id/history */
  getSessionHistory(sessionId: string, type: HistoryType): Promise<GetSessionHistoryResponse> {
    return this.request(
      "GET",
      `/sessions/${sessionId}/history?${new URLSearchParams({ type }).toString()}`,
    );
  }

  /** POST /sessions */
  createSession(req: CreateSessionRequest): Promise<PostSessionsResponse> {
    return this.request("POST", "/sessions", req);
  }

  /** POST /sessions/:id/turns — non-streaming */
  sendTurn(
    sessionId: string,
    req: SessionTurnRequest & { stream?: "none" },
  ): Promise<PostSessionTurnResponse>;
  /** POST /sessions/:id/turns — SSE streaming */
  sendTurn(
    sessionId: string,
    req: SessionTurnRequest & { stream: "delta" | "message" },
  ): Promise<AsyncIterable<SSEEvent>>;
  sendTurn(
    sessionId: string,
    req: SessionTurnRequest,
  ): Promise<PostSessionTurnResponse | AsyncIterable<SSEEvent>> {
    if (req.stream === "delta" || req.stream === "message") {
      return this.streamRequest("POST", `/sessions/${sessionId}/turns`, req);
    }
    return this.request("POST", `/sessions/${sessionId}/turns`, req);
  }

  /** DELETE /sessions/:id */
  deleteSession(sessionId: string): Promise<void> {
    return this.request("DELETE", `/sessions/${sessionId}`);
  }
}

async function* parseSSE(body: ReadableStream<Uint8Array>): AsyncIterable<SSEEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const queue: SSEEvent[] = [];

  const parser = createParser({
    onEvent({ event, data }) {
      queue.push({ event, ...JSON.parse(data) } as SSEEvent);
    },
  });

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.feed(decoder.decode(value, { stream: true }));
      while (queue.length > 0) yield queue.shift()!;
    }
  } finally {
    reader.releaseLock();
  }
}
