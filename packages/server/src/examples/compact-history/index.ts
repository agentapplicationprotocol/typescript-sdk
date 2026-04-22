import { serve } from "@hono/node-server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { aap } from "../../server.js";
import { Agent } from "../../agent.js";
import { AiModelProvider } from "../../model.js";
import { createOpenAI } from "@ai-sdk/openai";
import { TruncatedHistorySession, sessions } from "./session.js";
import type {
  PostSessionsRequest,
  PostSessionsResponse,
  HistoryType,
  PostSessionTurnRequest,
} from "@agentapplicationprotocol/core";
import type { Handler } from "../../server.js";

/** Agent definition with options, capabilities, and tools. */
const agent = new Agent("compact-history-agent", {
  version: "0.1.0",
  description:
    "An AAP-compatible agent with sliding-window history compaction, powered by Vercel AI SDK.",
})
  .stream({ delta: {}, message: {}, none: {} })
  .application({ tools: {} })
  .image({ http: {}, data: {} })
  .history({ compacted: {}, full: {} })
  .option({
    name: "baseURL",
    title: "LLM Base URL",
    description: "OpenAI-compatible base URL",
    type: "text",
    default: "",
  })
  .option({
    name: "apiKey",
    title: "LLM API Key",
    description: "OpenAI API key",
    type: "secret",
    default: "",
  })
  .option({
    name: "model",
    title: "Model",
    description: "Model ID to use",
    type: "text",
    default: "gpt-4o",
  })
  .tool(
    "web_fetch",
    {
      description: "Fetch the text content of a URL",
      inputSchema: z.object({ url: z.string().describe("URL to fetch") }),
    },
    async ({ url }) => {
      const res = await fetch(url);
      const text = await res.text();
      return text
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 8000);
    },
  );

const handler: Handler<TruncatedHistorySession> = {
  getMeta() {
    return { agents: [agent.info] };
  },

  postSessions(req: PostSessionsRequest): Promise<PostSessionsResponse> {
    const sessionId = `sess_${randomUUID()}`;
    // Build the model from client-supplied options
    const openai = createOpenAI({
      baseURL: req.agent.options?.baseURL || undefined,
      apiKey: req.agent.options?.apiKey || undefined,
    });
    const model = new AiModelProvider(openai.chat(req.agent.options?.model ?? "gpt-4o"));
    const session = new TruncatedHistorySession(
      sessionId,
      agent,
      model,
      req.agent,
      req.tools ?? [],
      req.messages ?? [],
    );
    sessions.set(sessionId, session);
    return Promise.resolve({ sessionId });
  },

  postSessionTurnStreamNone(session: TruncatedHistorySession, req: PostSessionTurnRequest) {
    return session.runTurnStreamNone(req);
  },
  postSessionTurnStreamDelta(
    session: TruncatedHistorySession,
    req: PostSessionTurnRequest,
    onEvent,
  ) {
    return session.runTurnStreamDelta(req, onEvent);
  },
  postSessionTurnStreamMessage(
    session: TruncatedHistorySession,
    req: PostSessionTurnRequest,
    onEvent,
  ) {
    return session.runTurnStreamMessage(req, onEvent);
  },

  async getSession(sessionId: string) {
    return sessions.get(sessionId);
  },

  async getSessionHistory(sessionId: string, type: HistoryType) {
    const session = sessions.get(sessionId);
    return type === "compacted" ? session?.history : session?.fullHistory;
  },

  async getSessions() {
    return {
      sessions: [...sessions.values()].map((s) => s.toSessionInfo()),
    };
  },

  async deleteSession(sessionId: string) {
    sessions.delete(sessionId);
  },
};

const port = Number(process.env.PORT ?? 3010);
const app = new Hono();
app.use("*", cors({ origin: "*" }));
app.route("/", aap(handler));
serve({ fetch: app.fetch, port });
console.log(`compact-history-agent running on http://localhost:${port}`);
