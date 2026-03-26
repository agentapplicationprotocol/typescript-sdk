/**
 * 03-client-tool — Client
 *
 * Demonstrates the client-side tool use flow:
 *   1. Declare the tool in createSession()
 *   2. Agent stops with stopReason: "tool_use" and a tool_use content block
 *   3. Client executes the tool locally
 *   4. Client re-submits the result via sendTurn() with a tool message
 *   5. Agent continues and returns the final response
 *
 * Run: npm run example:client-tool:client  (start the server first)
 */

import { Client } from "../../";

// The calculate tool is owned and executed by the client
function calculate(expression: string): string {
  try {
    return String(Function(`"use strict"; return (${expression})`)());
  } catch {
    return "error";
  }
}

const client = new Client({ baseUrl: "http://localhost:3002", apiKey: "example-key" });

async function main() {
  // Declare the client-side tool so the agent knows it can request it
  const response = await client.createSession({
    agent: { name: "calculator-agent" },
    messages: [{ role: "user", content: "Calculate something for me." }],
    tools: [{
      name: "calculate",
      description: "Evaluates a math expression",
      inputSchema: {
        type: "object",
        properties: { expression: { type: "string" } },
        required: ["expression"],
      },
    }],
  });

  console.log("Stop reason:", response.stopReason); // "tool_use"

  if (response.stopReason === "tool_use") {
    // Find the tool_use block in the assistant message
    const toolUse = response.messages
      .flatMap((m) => Array.isArray(m.content) ? m.content : [])
      .find((b) => b.type === "tool_use");

    if (toolUse?.type === "tool_use") {
      // Execute the tool locally
      const result = calculate(toolUse.input.expression as string);
      console.log(`Executing calculate(${toolUse.input.expression}) = ${result}`);

      // Re-submit the result so the agent can continue
      const next = await client.sendTurn(response.sessionId!, {
        messages: [{ role: "tool", toolCallId: toolUse.toolCallId, content: result }],
      });

      const reply = next.messages.at(-1);
      console.log("Final response:", reply && "content" in reply ? reply.content : "");
    }
  }
}

main().catch(console.error);
