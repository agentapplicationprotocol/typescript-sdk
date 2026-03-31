import { serve } from "@hono/node-server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Server } from "../../server.js";
import { Agent } from "../../agent.js";
import { AiModelProvider } from "../../model.js";
import { createOpenAI } from "@ai-sdk/openai";
import { TruncatedHistorySession, sessions } from "./session.js";
import type {
  CreateSessionRequest,
  CreateSessionResponse,
  SessionTurnRequest,
  SSEEvent,
} from "@agentapplicationprotocol/core";
import type { ServerHandler } from "../../server.js";

/** Agent definition with options, capabilities, and tools. */
const agent = new Agent("compact-history-agent", {
  version: "0.1.0",
  description:
    "An AAP-compatible agent with sliding-window history compaction, powered by Vercel AI SDK.",
})
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

const handler: ServerHandler = {
  getMeta() {
    return { version: 1, agents: [agent.info] };
  },

  createSession(
    req: CreateSessionRequest,
  ): Promise<CreateSessionResponse> | AsyncIterable<SSEEvent> {
    const sessionId = `sess_${randomUUID()}`;
    // Build the model from client-supplied options
    const openai = createOpenAI({
      baseURL: req.agent.options?.baseURL || undefined,
      apiKey: req.agent.options?.apiKey || undefined,
    });
    const model = new AiModelProvider(openai.chat(req.agent.options?.model ?? "gpt-4o"));
    const session = new TruncatedHistorySession(sessionId, agent, model, req.agent, req.tools);
    sessions.set(sessionId, session);
    return session.runNewSession(req);
  },

  sendTurn(sessionId: string, req: SessionTurnRequest) {
    const session = sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    return session.runTurn(req);
  },

  async getSession(sessionId: string) {
    const session = sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    // history exposes both the compacted window and the full uncompacted history
    return {
      ...session.toSessionResponse(),
      history: { compacted: session.history, full: session.fullHistory },
    };
  },

  async listSessions() {
    return { sessions: [...sessions.keys()] };
  },

  async deleteSession(sessionId: string) {
    sessions.delete(sessionId);
  },
};

const port = Number(process.env.PORT ?? 3010);
const server = new Server(handler, { cors: "*" });
serve({ fetch: server.app.fetch, port });
console.log(`compact-history-agent running on http://localhost:${port}`);
