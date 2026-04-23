#!/usr/bin/env node
/**
 * AAP CLI — interactive chat client
 *
 * Usage: BASE_URL=http://localhost:3010 API_KEY=secret tsx src/examples/cli/index.ts [agent-name]
 *
 * Slash commands:
 *   /stream delta|message|none   — set streaming mode
 *   /enable <tool>               — enable a server or client tool
 *   /disable <tool>              — disable a server or client tool
 *   /trust <tool>                — trust a tool (server: run inline; client: auto-execute without confirmation)
 *   /set <option>=<value>        — set an agent option
 *   /help                        — show this help
 *   /quit                        — exit
 */

import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { Client } from "../../client.js";
import { Session } from "../../session.js";
import type { PendingToolUse } from "../../utils.js";
import type { AgentInfo, SSEEvent, StreamMode, ToolSpec } from "@agentapplicationprotocol/core";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3010";
const API_KEY = process.env.API_KEY ?? "";
const client = new Client({ baseUrl: BASE_URL, apiKey: API_KEY });

// --- built-in client tools ---

const CLIENT_TOOLS: Record<string, { spec: ToolSpec; exec: (input: unknown) => unknown }> = {
  calculate: {
    spec: {
      name: "calculate",
      description: "Evaluate a mathematical expression",
      parameters: {
        type: "object",
        properties: {
          expression: {
            type: "string",
            description: "Math expression to evaluate",
          },
        },
        required: ["expression"],
      },
    },
    exec: (input: unknown) => {
      const { expression } = input as { expression: string };
      try {
        if (!/^[\d\s+\-*/().%^]+$/.test(expression)) return "Error: invalid expression";
        return Function(`"use strict"; return (${expression})`)();
      } catch {
        return "Error: could not evaluate expression";
      }
    },
  },
};

// --- state ---
let streamMode: StreamMode = "delta";
const enabledTools = new Set<string>(); // enabled server and client tools
const trustedTools = new Set<string>(); // trusted: server tools run inline; client tools auto-execute
const agentOptions: Record<string, string> = {};

let rl: readline.Interface;

function printHelp(agent: AgentInfo) {
  console.log("Commands:");
  console.log("  /stream delta|message|none");
  console.log("  /enable <tool>   — enable a server or client tool");
  console.log("  /disable <tool>  — disable a server or client tool");
  console.log("  /trust <tool>    — trust a tool (server: inline; client: auto-execute)");
  console.log("  /set <option>=<value>");
  console.log("  /help  /quit");
  if (agent.tools?.length) console.log("Server tools:", agent.tools.map((t) => t.name).join(", "));
  if (agent.options?.length)
    console.log(
      "Options:",
      agent.options.map((o) => `${o.name} (default: ${o.default})`).join(", "),
    );
  console.log("Client tools:", Object.keys(CLIENT_TOOLS).join(", "));
}

function handleCommand(line: string, agent: AgentInfo): boolean {
  const [cmd, ...args] = line.slice(1).trim().split(/\s+/);
  switch (cmd) {
    case "stream": {
      const mode = args[0] as StreamMode;
      if (!["delta", "message", "none"].includes(mode)) {
        console.log("Usage: /stream delta|message|none");
      } else {
        streamMode = mode;
        console.log(`Stream mode: ${streamMode}`);
      }
      return true;
    }
    case "enable": {
      const tool = args[0];
      if (!tool) {
        console.log("Usage: /enable <tool>");
        return true;
      }
      enabledTools.add(tool);
      console.log(`Enabled: ${tool}`);
      return true;
    }
    case "disable": {
      const tool = args[0];
      if (!tool) {
        console.log("Usage: /disable <tool>");
        return true;
      }
      enabledTools.delete(tool);
      console.log(`Disabled: ${tool}`);
      return true;
    }
    case "trust": {
      const tool = args[0];
      if (!tool) {
        console.log("Usage: /trust <tool>");
        return true;
      }
      if (trustedTools.has(tool)) {
        trustedTools.delete(tool);
        console.log(`Untrusted: ${tool}`);
      } else {
        trustedTools.add(tool);
        console.log(`Trusted: ${tool}`);
      }
      return true;
    }
    case "set": {
      const [key, ...rest] = args.join(" ").split("=");
      const value = rest.join("=");
      if (!key || value === undefined) {
        console.log("Usage: /set <option>=<value>");
        return true;
      }
      const name = key.trim();
      if (!agent.options?.some((o) => o.name === name)) {
        console.log(`Unknown option: ${name}`);
        return true;
      }
      agentOptions[name] = value;
      console.log(`Set ${name} = ${value}`);
      return true;
    }
    case "help":
      printHelp(agent);
      return true;
    case "quit":
      process.exit(0);
  }
  return false;
}

let inDelta = false;

function sseCallback(e: SSEEvent) {
  if (e.event === "text_delta") {
    process.stdout.write(e.delta);
    inDelta = true;
  } else if (e.event === "thinking_delta") {
    process.stdout.write(`\x1b[2m${e.delta}\x1b[0m`);
    inDelta = true;
  } else {
    if (inDelta) {
      process.stdout.write("\n");
      inDelta = false;
    }
    if (e.event === "text") console.log(e.text);
    else if (e.event === "thinking") console.log(`\x1b[2m${e.thinking}\x1b[0m`);
    else if (e.event === "tool_call")
      console.log(`[tool call: ${e.name}(${JSON.stringify(e.input)})]`);
  }
}

function printLastAssistant(session: Session) {
  if (streamMode !== "none") return;
  const last = session.history.at(-1);
  if (last?.role !== "assistant") return;
  const text =
    typeof last.content === "string"
      ? last.content
      : last.content
          .filter((b) => b.type === "text")
          .map((b) => (b as any).text)
          .join("");
  if (text) console.log(`Assistant: ${text}`);
}

async function confirm(prompt: string): Promise<boolean> {
  const answer = await rl.question(prompt);
  return answer.toLowerCase().startsWith("y");
}

/** Resolve pending tool calls, prompting for untrusted ones, looping until none remain. */
async function resolvePending(session: Session, pending: PendingToolUse): Promise<void> {
  while (pending.client.length > 0 || pending.server.length > 0) {
    const messages: { role: "tool"; toolCallId: string; content: string }[] = [];

    // client tools
    for (const t of pending.client) {
      const tool = CLIENT_TOOLS[t.name];
      if (!tool) {
        messages.push({
          role: "tool",
          toolCallId: t.toolCallId,
          content: `Unknown tool: ${t.name}`,
        });
        continue;
      }
      if (
        !trustedTools.has(t.name) &&
        !(await confirm(`Allow ${t.name}(${JSON.stringify(t.input)})? [y/N] `))
      ) {
        messages.push({
          role: "tool",
          toolCallId: t.toolCallId,
          content: "Tool use denied by user",
        });
        continue;
      }
      const result = String(tool.exec(t.input));
      console.log(`[${t.name} → ${result}]`);
      messages.push({
        role: "tool",
        toolCallId: t.toolCallId,
        content: result,
      });
    }

    // untrusted server tools — prompt for permission
    const permissions: {
      role: "tool_permission";
      toolCallId: string;
      granted: boolean;
      reason?: string;
    }[] = [];
    for (const t of pending.server) {
      const granted = await confirm(
        `Allow server tool ${t.name}(${JSON.stringify(t.input)})? [y/N] `,
      );
      permissions.push({
        role: "tool_permission",
        toolCallId: t.toolCallId,
        granted,
        reason: granted ? undefined : "denied by user",
      });
    }

    ({ pending } = await session.send(
      {
        messages: [...messages, ...permissions],
        stream: streamMode === "none" ? undefined : streamMode,
      },
      sseCallback,
    ));
    printLastAssistant(session);
  }
}

function getServerTools(agentInfo: AgentInfo) {
  return agentInfo.tools
    ?.filter((t) => enabledTools.has(t.name))
    .map((t) => ({ name: t.name, trust: trustedTools.has(t.name) }));
}

function getClientTools() {
  return Object.values(CLIENT_TOOLS)
    .filter((t) => enabledTools.has(t.spec.name))
    .map((t) => t.spec);
}

async function main() {
  const meta = await client.getMeta();
  const agentName = process.argv[2] ?? meta.agents[0]?.name;
  const agentInfo = meta.agents.find((a) => a.name === agentName);
  if (!agentInfo) {
    console.error(
      `Agent "${agentName}" not found. Available: ${meta.agents.map((a) => a.name).join(", ")}`,
    );
    process.exit(1);
  }

  console.log(`Connected to ${agentInfo.title ?? agentInfo.name} (${agentInfo.version})`);
  if (agentInfo.description) console.log(agentInfo.description);

  // enable all server and client tools by default
  agentInfo.tools?.forEach((t) => enabledTools.add(t.name));
  Object.keys(CLIENT_TOOLS).forEach((name) => enabledTools.add(name));

  if (agentInfo.tools?.length)
    console.log(`Server tools: ${agentInfo.tools.map((t) => t.name).join(", ")}`);
  console.log(`Client tools: ${Object.keys(CLIENT_TOOLS).join(", ")}`);
  if (agentInfo.options?.length)
    console.log(`Options: ${agentInfo.options.map((o) => `${o.name}=${o.default}`).join(", ")}`);
  console.log("Type /help for commands.\n");

  rl = readline.createInterface({ input: stdin, output: stdout });

  let firstInput: string;
  while (true) {
    firstInput = (await rl.question("You: ")).trim();
    if (!firstInput) continue;
    if (firstInput.startsWith("/")) {
      handleCommand(firstInput, agentInfo);
      continue;
    }
    break;
  }

  const session = await Session.create(
    client,
    {
      agent: {
        name: agentName,
        tools: getServerTools(agentInfo),
        options: Object.keys(agentOptions).length ? agentOptions : undefined,
      },
      tools: getClientTools(),
    },
    agentInfo,
  );
  const { pending } = await session.send(
    {
      messages: [{ role: "user", content: firstInput }],
      stream: streamMode === "none" ? undefined : streamMode,
    },
    sseCallback,
  );
  printLastAssistant(session);
  await resolvePending(session, pending);

  while (true) {
    const input = (await rl.question("You: ")).trim();
    if (!input) continue;
    if (input.startsWith("/")) {
      handleCommand(input, agentInfo);
      continue;
    }

    const { pending: turnPending } = await session.send(
      {
        agent: {
          tools: getServerTools(agentInfo),
          options: Object.keys(agentOptions).length ? { ...agentOptions } : undefined,
        },
        tools: getClientTools(),
        stream: streamMode === "none" ? undefined : streamMode,
        messages: [{ role: "user", content: input }],
      },
      sseCallback,
    );
    printLastAssistant(session);
    await resolvePending(session, turnPending);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
