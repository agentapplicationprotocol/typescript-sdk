/**
 * 04-server-tool-permission — Server
 *
 * Demonstrates a server-side tool with trust: false. The server owns the
 * tool but must ask the client for permission before executing it.
 * The agent stops with stopReason: "tool_use"; the client responds with
 * a tool_permission message (granted: true/false).
 *
 * Run: npm run example:server-tool-permission:server
 */

import { serve } from "@hono/node-server";
import { Server, ServerHandler, Message } from "../../";

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
        name: "permission-agent",
        version: "1.0.0",
        description: "Uses a server-side calculate tool that requires client permission.",
        // Declare the server-side tool so clients know it exists
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

    // Stop and ask the client for permission to run the tool
    const reply: Message = {
      role: "assistant",
      content: [{ type: "tool_use", toolCallId, name: "calculate", input: { expression: "99 * 99" } }],
    };
    return { sessionId, stopReason: "tool_use", messages: [reply] };
  },

  async sendTurn(sessionId, req) {
    // The client re-submits with a tool_permission message
    const permission = req.messages.find((m) => m.role === "tool_permission");
    if (permission?.role === "tool_permission") {
      if (!permission.granted) {
        // Client denied — inform the agent and end the turn
        return {
          stopReason: "end_turn",
          messages: [{ role: "assistant", content: `Tool was denied: ${permission.reason ?? "no reason given"}` }],
        };
      }
      // Client granted — execute the tool and return the result
      const result = calculate("99 * 99");
      return {
        stopReason: "end_turn",
        messages: [{ role: "assistant", content: `Result: ${result}` }],
      };
    }
    return { stopReason: "end_turn", messages: [{ role: "assistant", content: "Unexpected turn." }] };
  },

  async getSession(sessionId) {
    return { sessionId, agent: { name: "permission-agent" }, tools: [] };
  },

  async listSessions() { return { sessions: [] }; },
  async deleteSession() {},
};

const server = new Server(handler, { authenticate: (k) => k === "example-key", cors: "*" });
serve({ fetch: server.fetch, port: 3003 });
console.log("Server-tool (permission) server running on http://localhost:3003");
