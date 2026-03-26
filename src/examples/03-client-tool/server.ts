/**
 * 03-client-tool — Server
 *
 * Demonstrates client-side tool use. The server does not own or execute
 * the tool — it requests the client to run it by stopping with
 * stopReason: "tool_use". The client executes the tool and re-submits
 * the result via sendTurn().
 *
 * Run: npm run example:client-tool:server
 */

import { serve } from "@hono/node-server";
import { Server, ServerHandler, Message } from "../../";

const handler: ServerHandler = {
  async getMeta() {
    return {
      version: 1,
      agents: [{
        name: "calculator-agent",
        version: "1.0.0",
        description: "Uses a client-side calculate tool to evaluate expressions.",
        tools: [],
        options: [],
        capabilities: { history: { compacted: false, full: false } },
      }],
    };
  },

  async createSession(req) {
    const sessionId = `sess_${Date.now()}`;
    const toolCallId = "call_001";

    // Request the client-side tool — stop with tool_use so the client executes it
    const reply: Message = {
      role: "assistant",
      content: [{ type: "tool_use", toolCallId, name: "calculate", input: { expression: "123 * 456" } }],
    };
    return { sessionId, stopReason: "tool_use", messages: [reply] };
  },

  async sendTurn(sessionId, req) {
    // The client re-submits with a tool result message; use it to form the final reply
    const toolMsg = req.messages.find((m) => m.role === "tool");
    const result = toolMsg && "content" in toolMsg ? toolMsg.content : "unknown";
    return {
      stopReason: "end_turn",
      messages: [{ role: "assistant", content: `The result is: ${result}` }],
    };
  },

  async getSession(sessionId) {
    return { sessionId, agent: { name: "calculator-agent" }, tools: [] };
  },

  async listSessions() { return { sessions: [] }; },
  async deleteSession() {},
};

const server = new Server(handler, { authenticate: (k) => k === "example-key", cors: "*" });
serve({ fetch: server.fetch, port: 3002 });
console.log("Client-tool server running on http://localhost:3002");
