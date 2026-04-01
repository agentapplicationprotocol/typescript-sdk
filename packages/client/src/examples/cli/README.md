# cli example

An interactive terminal chat client for any AAP-compatible agent.

## Running

```bash
BASE_URL=http://localhost:3010 API_KEY=secret npm run example:cli
# target a specific agent by name:
BASE_URL=http://localhost:3010 npm run example:cli -- my-agent
```

Connects to the first available agent if no name is given.

## Slash commands

| Command                        | Description                                                                            |
| ------------------------------ | -------------------------------------------------------------------------------------- |
| `/stream delta\|message\|none` | Set streaming mode (default: `none`)                                                   |
| `/enable <tool>`               | Enable a server or client tool                                                         |
| `/disable <tool>`              | Disable a server or client tool                                                        |
| `/trust <tool>`                | Trust a tool — server tools run inline; client tools auto-execute without confirmation |
| `/set <option>=<value>`        | Set an agent option for subsequent turns                                               |
| `/help`                        | Show available commands, tools, and options                                            |
| `/quit`                        | Exit                                                                                   |

## Tools

All tools are disabled by default. Use `/enable <tool>` to activate.

**Client tools** (executed locally):

| Tool        | Description                                    |
| ----------- | ---------------------------------------------- |
| `calculate` | Evaluates a math expression (e.g. `2 + 2 * 3`) |

**Server tools** are declared by the agent — use `/enable <tool>` to send them in requests.

## Trust

Without `/trust`, the CLI prompts for confirmation before executing any tool (client or server). With `/trust <tool>`, client tools auto-execute and server tools are marked `trust: true` so the server runs them inline.
