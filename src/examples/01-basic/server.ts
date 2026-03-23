/**
 * 01-basic — Server
 *
 * A simple echo agent that stores sessions in memory and reflects
 * the user's message back as the assistant reply.
 *
 * Run: npm run example:basic:server
 */

import { serve } from "@hono/node-server";
import { Server, ServerHandler, SessionResponse, Message } from "../../";

// In-memory store keyed by sessionId
interface Session {
  sessionId: string;
  agent: string;
  tools: SessionResponse["tools"];
  serverTools: SessionResponse["serverTools"];
  options: SessionResponse["options"];
  messages: Message[];
}

const sessions = new Map<string, Session>();
let sessionCounter = 0;

function newSessionId(): string {
  return `sess_${String(++sessionCounter).padStart(3, "0")}`;
}

const handler: ServerHandler = {
  // Advertise the echo-agent with full history support
  async getMeta() {
    return {
      version: 1,
      agents: [{
        name: "echo-agent",
        version: "1.0.0",
        description: "Echoes back the user's message.",
        tools: [],
        options: [],
        capabilities: { history: { compacted: true, full: true } },
      }],
    };
  },

  // Create a new session, store it, and return the echo reply
  async createSession(req) {
    const sessionId = newSessionId();
    const lastMessage = req.messages.at(-1);
    const text = lastMessage && "content" in lastMessage && typeof lastMessage.content === "string"
      ? lastMessage.content : "Hello!";
    const reply: Message = { role: "assistant", content: `Echo: ${text}` };

    sessions.set(sessionId, {
      sessionId,
      agent: req.agent,
      tools: req.tools ?? [],
      serverTools: req.serverTools ?? [],
      options: req.options ?? {},
      messages: [...req.messages, reply],
    });

    return { sessionId, stopReason: "end_turn", messages: [reply] };
  },

  // Append the new turn to history and echo the reply
  async sendTurn(sessionId, req) {
    const session = sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const lastMessage = req.messages.at(-1);
    const text = lastMessage && "content" in lastMessage && typeof lastMessage.content === "string"
      ? lastMessage.content : "";
    const reply: Message = { role: "assistant", content: `Echo: ${text}` };

    session.messages.push(...req.messages, reply);

    return { stopReason: "end_turn", messages: [reply] };
  },

  // Return the session with full conversation history
  async getSession(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    return { ...session, history: { compacted: session.messages, full: session.messages } };
  },

  // Return paginated session IDs
  async listSessions({ limit, after }) {
    let ids = [...sessions.keys()];
    if (after) {
      const idx = ids.indexOf(after);
      if (idx !== -1) ids = ids.slice(idx + 1);
    }
    if (limit !== undefined) ids = ids.slice(0, limit);
    const nextCursor = ids.at(-1);
    return { sessions: ids, ...(nextCursor ? { nextCursor } : {}) };
  },

  async deleteSession(sessionId) {
    sessions.delete(sessionId);
  },
};

const server = new Server(handler, {
  authenticate: (apiKey) => apiKey === "example-key",
  cors: "*",
});

const PORT = 3000;
serve({ fetch: server.fetch, port: PORT });
console.log(`AAP server running on http://localhost:${PORT}`);
