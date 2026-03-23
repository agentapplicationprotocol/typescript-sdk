/**
 * 01-basic — Client
 *
 * Demonstrates the basic non-streaming request/response flow:
 *   1. Discover available agents via getMeta()
 *   2. Start a new session with createSession()
 *   3. Send a follow-up turn with sendTurn()
 *
 * Run: npm run example:basic:client  (start the server first)
 */

import { Client } from "../../";

const client = new Client({
  baseUrl: "http://localhost:3000",
  apiKey: "example-key",
});

async function main() {
  // Discover what agents are available on this server
  const meta = await client.getMeta();
  console.log("Agents:", meta.agents.map((a) => a.name));

  // Start a new session — the server returns a sessionId and the first reply
  const response = await client.createSession({
    agent: "echo-agent",
    messages: [{ role: "user", content: "Hello, world!" }],
  });
  console.log("Session ID:", response.sessionId);
  console.log("Response:", (response.messages.at(-1) as any).content);

  // Send a follow-up turn using the sessionId from above
  const next = await client.sendTurn(response.sessionId!, {
    messages: [{ role: "user", content: "How are you?" }],
  });
  console.log("Response:", (next.messages.at(-1) as any).content);
}

main().catch(console.error);
