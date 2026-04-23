# @agentapplicationprotocol/server

[![npm version](https://img.shields.io/npm/v/@agentapplicationprotocol/server)](https://www.npmjs.com/package/@agentapplicationprotocol/server)

AAP server for the [Agent Application Protocol (AAP)](https://github.com/agentapplicationprotocol/agent-application-protocol).

## Installation

```bash
npm install @agentapplicationprotocol/server
```

## Usage

```ts
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { aap, Agent, Session, AiModelProvider } from "@agentapplicationprotocol/server";

// 1. Define agent with capabilities and server-side tools
const agent = new Agent("my-agent", { version: "1.0.0" })
  .stream({ delta: {}, message: {}, none: {} })
  .tool("my_tool", { description: "...", inputSchema: z.object({ ... }) }, async (input) => {
    return "result";
  });

// 2. (Optional) Override Session to customize the agent loop
class MySession extends Session {
  protected async runStepStreamNone(incoming) {
    const res = await super.runStepStreamNone(incoming);
    this.history = this.history.slice(-20); // compact history
    return res;
  }
}

// 3. Create a Handler connecting your session store to AAP
const sessions = new Map<string, MySession>();

const handler = {
  getMeta: () => ({ agents: [agent.info] }),
  postSessions: async (req) => {
    const sessionId = `sess_${Date.now()}`;
    sessions.set(sessionId, new MySession(sessionId, agent, new AiModelProvider(...), req.agent, req.tools ?? [], req.messages ?? []));
    return { sessionId };
  },
  getSession: async (id) => sessions.get(id),
  getSessions: async () => ({ sessions: [...sessions.values()].map((s) => s.toSessionInfo()) }),
  getSessionHistory: async (id, type) => sessions.get(id)?.history,
  postSessionTurnStreamNone: (session, req) => session.runTurnStreamNone(req),
  postSessionTurnStreamDelta: (session, req, onEvent) => session.runTurnStreamDelta(req, onEvent),
  postSessionTurnStreamMessage: (session, req, onEvent) => session.runTurnStreamMessage(req, onEvent),
  deleteSession: async (id) => sessions.delete(id),
};

// 4. Serve with Hono
const app = new Hono();
app.route("/", aap(handler));
serve({ fetch: app.fetch, port: 3000 });
```

## Examples

- [Basic agent](./examples/basic)
- [Compact history agent](./examples/compact-history)
