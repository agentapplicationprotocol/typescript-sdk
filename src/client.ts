import { createParser } from "eventsource-parser";
import {
  AgentResponse,
  CreateSessionRequest,
  MetaResponse,
  SessionListResponse,
  SessionResponse,
  SessionTurnRequest,
  SSEEvent,
} from "./types";

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
    this.headers = { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` };
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

  /** GET /meta */
  getMeta(): Promise<MetaResponse> {
    return this.request("GET", "/meta");
  }

  /** PUT /session — non-streaming */
  createSession(req: CreateSessionRequest & { stream?: "none" }): Promise<AgentResponse>;
  /** PUT /session — SSE streaming */
  createSession(req: CreateSessionRequest & { stream: "delta" | "message" }): Promise<AsyncIterable<SSEEvent>>;
  createSession(req: CreateSessionRequest): Promise<AgentResponse | AsyncIterable<SSEEvent>> {
    if (req.stream === "delta" || req.stream === "message") {
      return this.streamRequest("PUT", "/session", req);
    }
    return this.request("PUT", "/session", req);
  }

  /** POST /session/:id — non-streaming */
  sendTurn(sessionId: string, req: SessionTurnRequest & { stream?: "none" }): Promise<AgentResponse>;
  /** POST /session/:id — SSE streaming */
  sendTurn(sessionId: string, req: SessionTurnRequest & { stream: "delta" | "message" }): Promise<AsyncIterable<SSEEvent>>;
  sendTurn(sessionId: string, req: SessionTurnRequest): Promise<AgentResponse | AsyncIterable<SSEEvent>> {
    if (req.stream === "delta" || req.stream === "message") {
      return this.streamRequest("POST", `/session/${sessionId}`, req);
    }
    return this.request("POST", `/session/${sessionId}`, req);
  }

  /** GET /session/:id */
  getSession(sessionId: string): Promise<SessionResponse> {
    return this.request("GET", `/session/${sessionId}`);
  }

  /** GET /sessions */
  listSessions(params?: { limit?: number; after?: string }): Promise<SessionListResponse> {
    let path = "/sessions";
    if (params) {
      const entries = Object.entries(params).filter((e): e is [string, string | number] => e[1] !== undefined);
      if (entries.length > 0) {
        path += "?" + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString();
      }
    }
    return this.request("GET", path);
  }

  /** DELETE /session/:id */
  deleteSession(sessionId: string): Promise<void> {
    return this.request("DELETE", `/session/${sessionId}`);
  }

  private async streamRequest(method: string, path: string, body: unknown): Promise<AsyncIterable<SSEEvent>> {
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
