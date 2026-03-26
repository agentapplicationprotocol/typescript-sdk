/**
 * 02-streaming — Client
 *
 * Demonstrates consuming SSE streams in both modes:
 *   - delta: iterate text_delta events and write each piece as it arrives
 *   - message: wait for a single text event with the complete response
 *
 * Run: npm run example:streaming:client  (start the server first)
 */

import { Client } from "../../";

const client = new Client({ baseUrl: "http://localhost:3001", apiKey: "example-key" });

async function main() {
  // delta mode — receive and print each word as it streams in
  console.log("--- delta mode ---");
  const chunkEvents = await client.createSession({
    agent: { name: "streaming-agent" },
    stream: "delta",
    messages: [{ role: "user", content: "Tell me something." }],
  });

  process.stdout.write("Response: ");
  for await (const event of chunkEvents) {
    if (event.event === "text_delta") process.stdout.write(event.delta);
    if (event.event === "turn_stop") console.log(`\nStop: ${event.stopReason}`);
  }

  // message mode — wait for the full text in one event
  console.log("--- message mode ---");
  const msgEvents = await client.createSession({
    agent: { name: "streaming-agent" },
    stream: "message",
    messages: [{ role: "user", content: "Tell me something." }],
  });

  for await (const event of msgEvents) {
    if (event.event === "text") console.log("Response:", event.text);
    if (event.event === "turn_stop") console.log(`Stop: ${event.stopReason}`);
  }
}

main().catch(console.error);
