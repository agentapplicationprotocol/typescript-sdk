# @agentapplicationprotocol/sdk

TypeScript SDK for the [Agent Application Protocol (AAP)](https://github.com/agentapplicationprotocol/agent-application-protocol).

## Installation

```bash
npm install @agentapplicationprotocol/sdk
```

---

## Client

### Setup

```typescript
import { Client } from "@agentapplicationprotocol/sdk";

const client = new Client({
  baseUrl: "https://your-agent-server.example.com",
  apiKey: "your-api-key",
});
```

### Discover agents — `getMeta()`

```typescript
const meta = await client.getMeta();
console.log(meta.agents);
```

### Create a session — `PUT /session`

**Non-streaming:**

```typescript
const response = await client.createSession({
  agent: "research-agent",
  messages: [{ role: "user", content: "What's the capital of France?" }],
});
// response.sessionId, response.stopReason, response.messages
```

**Streaming:**

```typescript
const events = await client.createSession({
  agent: "research-agent",
  stream: "chunk",
  messages: [{ role: "user", content: "What's the capital of France?" }],
});

let sessionId: string | undefined;
for await (const event of events) {
  if (event.event === "session_start") sessionId = event.sessionId;
  if (event.event === "text_delta") process.stdout.write(event.delta);
  if (event.event === "message_stop") console.log("\nStop:", event.stopReason);
}
```

### Send a follow-up turn — `POST /session/:id`

```typescript
const events = await client.sendTurn(sessionId, {
  stream: "chunk",
  messages: [{ role: "user", content: "What about Berlin?" }],
});

for await (const event of events) {
  if (event.event === "text_delta") process.stdout.write(event.delta);
}
```

### Tool calling

When the agent needs a client-side tool, it stops with `stopReason: "tool_use"`. Execute the tool and re-submit:

```typescript
const response = await client.createSession({
  agent: "research-agent",
  messages: [{ role: "user", content: "What's the weather in Tokyo?" }],
  tools: [{
    name: "get_weather",
    description: "Get current weather for a location",
    inputSchema: {
      type: "object",
      properties: { location: { type: "string" } },
      required: ["location"],
    },
  }],
});

if (response.stopReason === "tool_use") {
  const toolUse = response.messages
    .flatMap(m => Array.isArray(m.content) ? m.content : [])
    .find(b => b.type === "tool_use");

  if (toolUse?.type === "tool_use") {
    const result = await getWeather(toolUse.input.location as string);

    const next = await client.sendTurn(response.sessionId!, {
      messages: [{ role: "tool", toolCallId: toolUse.toolCallId, content: result }],
    });
    console.log(next.messages);
  }
}
```

### Other methods

```typescript
const session = await client.getSession("sess_abc123");

const { sessions, nextCursor } = await client.listSessions({ limit: 20 });

await client.deleteSession("sess_abc123");
```

---

## Server

Implement `ServerHandler` and pass it to `Server`. The underlying HTTP server is [Hono](https://hono.dev), so `server.fetch` works on Node, Bun, Deno, Cloudflare Workers, and any WinterCG-compatible runtime.

### Implement a handler

```typescript
import { Server, ServerHandler } from "@agentapplicationprotocol/sdk";

const handler: ServerHandler = {
  async getMeta() {
    return {
      version: 1,
      agents: [{
        name: "my-agent",
        version: "1.0.0",
        description: "My agent",
        tools: [],
        options: [],
        capabilities: { history: { compacted: false, full: false } },
      }],
    };
  },

  async createSession(req) {
    // Return AgentResponse for non-streaming, or AsyncIterable<SSEEvent> for streaming
    if (req.stream === "chunk" || req.stream === "message") {
      return (async function* () {
        yield { event: "session_start" as const, sessionId: "sess_001" };
        yield { event: "message_start" as const };
        yield { event: "text_delta" as const, delta: "Hello!" };
        yield { event: "message_stop" as const, stopReason: "end_turn" as const };
      })();
    }
    return {
      sessionId: "sess_001",
      stopReason: "end_turn",
      messages: [{ role: "assistant", content: "Hello!" }],
    };
  },

  async sendTurn(sessionId, req) {
    return {
      stopReason: "end_turn",
      messages: [{ role: "assistant", content: "Got it." }],
    };
  },

  async getSession(sessionId) {
    return { sessionId, agent: "my-agent", tools: [], serverTools: [], options: {} };
  },

  async listSessions({ limit, after }) {
    return { sessions: [] };
  },

  async deleteSession(sessionId) {},
};

const server = new Server(handler, {
  authenticate: (apiKey) => apiKey === process.env.API_KEY,
});
```

### Run on Node.js

```typescript
import { serve } from "@hono/node-server";
serve({ fetch: server.fetch, port: 3000 });
```

### Run on Bun or Cloudflare Workers

```typescript
export default server;
```

---

## SSE events

| Event | Mode | Fields |
|---|---|---|
| `session_start` | both | `sessionId` |
| `message_start` | both | — |
| `text_delta` | chunk | `delta` |
| `thinking_delta` | chunk | `delta` |
| `text` | message | `text` |
| `thinking` | message | `thinking` |
| `tool_call` | both | `toolCallId`, `name`, `input` |
| `tool_result` | both | `toolCallId`, `content` |
| `message_stop` | both | `stopReason` |

## License

Apache-2.0
