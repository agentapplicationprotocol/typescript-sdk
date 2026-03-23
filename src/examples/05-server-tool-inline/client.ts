/**
 * 05-server-tool-inline — Client
 *
 * Demonstrates consuming a trusted server-side tool (trust: true).
 * The server executes the tool inline — the client observes tool_call
 * and tool_result events in the stream but never needs to act on them.
 * The stream continues to the final text response without stopping.
 *
 * Run: npm run example:server-tool-inline:client  (start the server first)
 */

import { Client } from "../../";

const client = new Client({ baseUrl: "http://localhost:3004", apiKey: "example-key" });

async function main() {
  const events = await client.createSession({
    agent: "inline-agent",
    stream: "chunk",
    messages: [{ role: "user", content: "Calculate something." }],
    // trust: true — server executes the tool inline, no permission needed
    serverTools: [{ name: "calculate", trust: true }],
  });

  for await (const event of events) {
    // Observe the tool being called by the server
    if (event.event === "tool_call") {
      console.log(`Tool call: ${event.name}(${JSON.stringify(event.input)})`);
    }
    // Observe the result returned by the server
    if (event.event === "tool_result") {
      console.log(`Tool result: ${event.content}`);
    }
    // Stream the final text response
    if (event.event === "text_delta") process.stdout.write(event.delta);
    if (event.event === "message_stop") console.log(`\nStop: ${event.stopReason}`);
  }
}

main().catch(console.error);
