import type { HistoryMessage, ToolCall, ToolSpec } from "@agentapplicationprotocol/core";

/**
 * Inspects the last assistant message in `messages` and classifies its unresolved `tool_use` blocks
 * into client-side tools (matched against `clientTools`) and server-side tools (requiring permission).
 */
export function resolvePendingToolUse(
  messages: HistoryMessage[],
  clientTools?: ToolSpec[],
): { client: ToolCall[]; server: ToolCall[] } {
  const last = [...messages].reverse().find((m) => m.role === "assistant");
  if (!last || !Array.isArray(last.content)) return { client: [], server: [] };

  const resolved = new Set(messages.filter((m) => m.role === "tool").map((m) => m.toolCallId));

  const clientNames = new Set(clientTools?.map((t) => t.name) ?? []);
  const client: ToolCall[] = [];
  const server: ToolCall[] = [];

  for (const block of last.content) {
    if (block.type !== "tool_use" || resolved.has(block.toolCallId)) continue;
    const { toolCallId, name, input } = block;
    (clientNames.has(name) ? client : server).push({ toolCallId, name, input });
  }

  return { client, server };
}
