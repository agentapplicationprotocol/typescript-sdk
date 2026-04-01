# @agentapplicationprotocol/client

[![npm version](https://img.shields.io/npm/v/@agentapplicationprotocol/client)](https://www.npmjs.com/package/@agentapplicationprotocol/client)

AAP client for the [Agent Application Protocol (AAP)](https://github.com/agentapplicationprotocol/agent-application-protocol).

## Installation

```bash
npm install @agentapplicationprotocol/client
```

## Usage

```ts
import { Client, Session } from "@agentapplicationprotocol/client";

const client = new Client({ baseUrl: "http://localhost:3010", apiKey: "..." });

const session = await Session.create(client, "my-agent", {
  messages: [{ role: "user", content: "Hello!" }],
});
```

## Examples

- [Basic example](./src/examples/basic) — sends a few prompts without streaming
- [CLI example](./src/examples/cli) — interactive terminal chat client
