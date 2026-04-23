# @agentapplicationprotocol/sdk

[![npm version](https://img.shields.io/npm/v/@agentapplicationprotocol/sdk)](https://www.npmjs.com/package/@agentapplicationprotocol/sdk)
[![jsdocs.io](https://img.shields.io/badge/jsdocs.io-reference-blue)](https://www.jsdocs.io/package/@agentapplicationprotocol/sdk)

Umbrella package for the [Agent Application Protocol (AAP)](https://github.com/agentapplicationprotocol/agent-application-protocol) TypeScript SDK. Re-exports all packages.

## Installation

```bash
npm install @agentapplicationprotocol/sdk
```

## Usage

```ts
import { client, server } from "@agentapplicationprotocol/sdk";

// client
const c = new client.Client({ baseUrl: "...", apiKey: "..." });

// server
const agent = new server.Agent("my-agent", { version: "1.0.0" });
```

Or install individual packages directly:

| Package                                                                                              | Description                |
| ---------------------------------------------------------------------------------------------------- | -------------------------- |
| [`@agentapplicationprotocol/core`](https://www.npmjs.com/package/@agentapplicationprotocol/core)     | Shared types and utilities |
| [`@agentapplicationprotocol/client`](https://www.npmjs.com/package/@agentapplicationprotocol/client) | AAP client                 |
| [`@agentapplicationprotocol/server`](https://www.npmjs.com/package/@agentapplicationprotocol/server) | AAP server                 |

For detailed usage, refer to the individual package documentation:

- [`@agentapplicationprotocol/client` docs](https://github.com/agentapplicationprotocol/typescript-sdk/tree/main/packages/client)
- [`@agentapplicationprotocol/server` docs](https://github.com/agentapplicationprotocol/typescript-sdk/tree/main/packages/server)
