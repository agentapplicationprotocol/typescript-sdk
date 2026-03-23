/**
 * 04-server-tool-permission — Client
 *
 * Demonstrates responding to a server-side tool permission request:
 *   - When the agent stops with stopReason: "tool_use" for a server tool,
 *     the client sends a tool_permission message (granted: true or false).
 *   - If granted, the server executes the tool and continues.
 *   - If denied, the server informs the agent and ends the turn.
 *
 * Run: npm run example:server-tool-permission:client  (start the server first)
 */

import { Client } from "../../";

const client = new Client({ baseUrl: "http://localhost:3003", apiKey: "example-key" });

async function main() {
  // --- Grant permission ---
  console.log("--- permission granted ---");
  const r1 = await client.createSession({
    agent: "permission-agent",
    messages: [{ role: "user", content: "Calculate something." }],
    // Declare the server tool with trust: false — permission required before execution
    serverTools: [{ name: "calculate", trust: false }],
  });

  console.log("Stop reason:", r1.stopReason); // "tool_use"

  const toolCall = r1.messages
    .flatMap((m) => Array.isArray(m.content) ? m.content : [])
    .find((b) => b.type === "tool_use");

  if (toolCall?.type === "tool_use") {
    console.log(`Server wants to call: ${toolCall.name}(${JSON.stringify(toolCall.input)})`);

    // Grant permission — server will execute the tool and return the result
    const granted = await client.sendTurn(r1.sessionId!, {
      messages: [{ role: "tool_permission", toolCallId: toolCall.toolCallId, granted: true }],
    });
    const reply = granted.messages.at(-1);
    console.log("Response:", reply && "content" in reply ? reply.content : "");
  }

  // --- Deny permission ---
  console.log("\n--- permission denied ---");
  const r2 = await client.createSession({
    agent: "permission-agent",
    messages: [{ role: "user", content: "Calculate something." }],
    serverTools: [{ name: "calculate", trust: false }],
  });

  const toolCall2 = r2.messages
    .flatMap((m) => Array.isArray(m.content) ? m.content : [])
    .find((b) => b.type === "tool_use");

  if (toolCall2?.type === "tool_use") {
    // Deny permission — server will relay the reason to the agent
    const denied = await client.sendTurn(r2.sessionId!, {
      messages: [{ role: "tool_permission", toolCallId: toolCall2.toolCallId, granted: false, reason: "User declined" }],
    });
    const reply = denied.messages.at(-1);
    console.log("Response:", reply && "content" in reply ? reply.content : "");
  }
}

main().catch(console.error);
