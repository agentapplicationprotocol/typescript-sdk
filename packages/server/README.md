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
import { aap, Agent, Session } from "@agentapplicationprotocol/server";

const agent = new Agent("my-agent", { version: "1.0.0" });

const app = new Hono();
app.route(
  "/",
  aap({
    getMeta: () => ({ version: 1, agents: [agent.info] }),
    // ... implement Handler interface
  }),
);
```

## Examples

- [Basic agent](./src/examples/basic)
- [Compact history agent](./src/examples/compact-history)
