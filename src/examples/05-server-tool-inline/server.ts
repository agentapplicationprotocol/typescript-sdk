/**
 * 05-server-tool-inline — Server
 *
 * Demonstrates a trusted server-side tool (trust: true). The server
 * executes the tool inline without stopping — it emits tool_call,
 * tool_result, and then continues streaming the final text response,
 * all in a single uninterrupted SSE stream.
 *
 * Run: npm run example:server-tool-inline:server
 */

import { serve } from "@hono/node-server";
import { Server, ServerHandler } from "../../";

function calculate(expression: string): string {
  try {
    return String(Function(`"use strict"; return (${expression})`)());
  } catch {
    return "error";
  }
}

const handler: ServerHandler = {
  async getMeta() {
    return {
      version: 1,
      agents: [{
        name: "inline-agent",
        version: "1.0.0",
        description: "Uses a trusted server-side calculate tool executed inline.",
        // Declare the server-side tool
        tools: [{
          name: "calculate",
          description: "Evaluates a math expression",
          inputSchema: {
            type: "object",
            properties: { expression: { type: "string" } },
            required: ["expression"],
          },
        }],
        options: [],
        capabilities: { history: { compacted: false, full: false } },
      }],
    };
  },

  async createSession(req) {
    const sessionId = `sess_${Date.now()}`;
    const toolCallId = "call_001";
    const expression = "42 * 42";

    // Execute the tool immediately — no client round-trip needed
    const result = calculate(expression);

    // Stream tool_call + tool_result inline, then continue with the text response
    return (async function* () {
      yield { event: "session_start" as const, sessionId };
      yield { event: "message_start" as const };
      yield { event: "tool_call" as const, toolCallId, name: "calculate", input: { expression } };
      yield { event: "tool_result" as const, toolCallId, content: result };
      yield { event: "text_delta" as const, delta: `The result of ${expression} is ${result}.` };
      yield { event: "message_stop" as const, stopReason: "end_turn" as const };
    })();
  },

  async sendTurn(sessionId, req) {
    return { stopReason: "end_turn", messages: [{ role: "assistant", content: "OK" }] };
  },

  async getSession(sessionId) {
    return { sessionId, agent: "inline-agent", tools: [], serverTools: [], options: {} };
  },

  async listSessions() { return { sessions: [] }; },
  async deleteSession() {},
};

const server = new Server(handler, { authenticate: (k) => k === "example-key", cors: "*" });
serve({ fetch: server.fetch, port: 3004 });
console.log("Server-tool (inline) server running on http://localhost:3004");
