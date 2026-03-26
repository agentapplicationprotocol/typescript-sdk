/**
 * 02-streaming — Server
 *
 * Demonstrates both SSE streaming modes:
 *   - chunk: emits text word-by-word as text_delta events
 *   - message: emits the full text in a single text event
 *
 * Run: npm run example:streaming:server
 */

import { serve } from "@hono/node-server";
import { Server, ServerHandler } from "../../";

const handler: ServerHandler = {
  async getMeta() {
    return {
      version: 1,
      agents: [{
        name: "streaming-agent",
        version: "1.0.0",
        description: "Streams a response word by word.",
        tools: [],
        options: [],
        capabilities: { stream: { message: {}, delta: {} }},
      }],
    };
  },

  async createSession(req) {
    const sessionId = `sess_${Date.now()}`;
    const words = "The quick brown fox jumps over the lazy dog".split(" ");

    if (req.stream === "message") {
      // message mode: send the complete text in one event
      return (async function* () {
        yield { event: "session_start" as const, sessionId };
        yield { event: "turn_start" as const };
        yield { event: "text" as const, text: words.join(" ") };
        yield { event: "turn_stop" as const, stopReason: "end_turn" as const };
      })();
    }

    // delta mode (default): stream each word as an incremental delta
    return (async function* () {
      yield { event: "session_start" as const, sessionId };
      yield { event: "turn_start" as const };
      for (const word of words) {
        yield { event: "text_delta" as const, delta: word + " " };
      }
      yield { event: "turn_stop" as const, stopReason: "end_turn" as const };
    })();
  },

  async sendTurn(sessionId, req) {
    return { stopReason: "end_turn", messages: [{ role: "assistant", content: "OK" }] };
  },

  async getSession(sessionId) {
    return { sessionId, agent: { name: "streaming-agent" }, tools: [] };
  },

  async listSessions() { return { sessions: [] }; },
  async deleteSession() {},
};

const server = new Server(handler, { authenticate: (k) => k === "example-key", cors: "*" });
serve({ fetch: server.fetch, port: 3001 });
console.log("Streaming server running on http://localhost:3001");
