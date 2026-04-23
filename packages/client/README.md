# @agentapplicationprotocol/client

[![npm version](https://img.shields.io/npm/v/@agentapplicationprotocol/client)](https://www.npmjs.com/package/@agentapplicationprotocol/client)

AAP client for the [Agent Application Protocol (AAP)](https://github.com/agentapplicationprotocol/agent-application-protocol).

## Installation

```bash
npm install @agentapplicationprotocol/client
```

## Usage

### New session

```ts
import { Client, Session } from "@agentapplicationprotocol/client";
import { ToolRegistry } from "@agentapplicationprotocol/core";
import z from "zod";

// 1. Define client-side tools
const clientTools = new ToolRegistry();
clientTools.register(
  "get_time",
  { description: "Return the current time", inputSchema: z.object({}) },
  async () => new Date().toISOString(),
);

// 2. Create client instance
const client = new Client({ baseUrl: "http://localhost:3010", apiKey: "..." });

// 3. Fetch meta to discover available agents
const meta = await client.getMeta();

// 4. Choose an agent, configure options, and provide client tool specs to create a session
const agentInfo = meta.agents.find((a) => a.name === "my-agent")!;
const session = await Session.create(
  client,
  {
    agent: { name: agentInfo.name, options: { tone: "concise" } },
    tools: clientTools.tools, // advertise client tools to the agent
  },
  agentInfo,
);

// 5. Send a turn and get the response + any pending tool calls
const { messages, pending } = await session.send({
  messages: [{ role: "user", content: "What time is it?" }],
  stream: "delta",
});

// 6. Handle tool calls; if none, prompt the user for the next message
if (pending.client.length > 0) {
  const results = await Promise.all(pending.client.map((t) => clientTools.exec(t)));
  await session.send({ messages: results });
} else if (pending.server.length > 0) {
  // grant or deny server-side tool calls
  await session.send({
    messages: pending.server.map((t) => ({
      role: "tool_permission" as const,
      toolCallId: t.toolCallId,
      granted: true,
    })),
  });
} else {
  // no pending tool calls — ready for the next user prompt
}
```

### Resuming an existing session

```ts
import { Client, Session } from "@agentapplicationprotocol/client";
import { ToolRegistry } from "@agentapplicationprotocol/core";
import z from "zod";

// 1. Define client-side tools (same registry as when the session was created)
const clientTools = new ToolRegistry();
clientTools.register(
  "get_time",
  { description: "Return the current time", inputSchema: z.object({}) },
  async () => new Date().toISOString(),
);

// 2. Create client instance
const client = new Client({ baseUrl: "http://localhost:3010", apiKey: "..." });

// 3. Fetch meta
const meta = await client.getMeta();

// 4. List existing sessions
const { sessions } = await client.getSessions();

// 5. Load session history and resolve any pending tool calls from the previous turn
const agentInfo = meta.agents.find((a) => a.name === "my-agent")!;
const { session, pending } = await Session.load(client, sessions[0], agentInfo, "full");

// 6. Send tool results if there are pending calls, otherwise send the next user prompt
if (pending.client.length > 0 || pending.server.length > 0) {
  const results = await Promise.all(pending.client.map((t) => clientTools.exec(t)));
  await session.send({ messages: results });
} else {
  await session.send({ messages: [{ role: "user", content: "Continue." }] });
}
```

## Examples

- [Basic example](./examples/basic) — sends a few prompts without streaming
- [CLI example](./examples/cli) — interactive terminal chat client
