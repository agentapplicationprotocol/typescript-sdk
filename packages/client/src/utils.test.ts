import { describe, it, expect } from "vitest";
import { resolvePendingToolUse } from "./utils";
import type { HistoryMessage, ToolSpec } from "@agentapplicationprotocol/core";

describe("resolvePendingToolUse", () => {
  const clientTool: ToolSpec = {
    name: "client_tool",
    description: "d",
    parameters: { type: "object" },
  };

  it("classifies client and server tools", () => {
    const messages: HistoryMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "tool_use", toolCallId: "c1", name: "client_tool", input: {} },
          { type: "tool_use", toolCallId: "s1", name: "server_tool", input: {} },
        ],
      },
    ];
    const { client, server } = resolvePendingToolUse(messages, [clientTool]);
    expect(client).toEqual([{ toolCallId: "c1", name: "client_tool", input: {} }]);
    expect(server).toEqual([{ toolCallId: "s1", name: "server_tool", input: {} }]);
  });

  it("skips tool_use blocks already resolved by tool_result", () => {
    const messages: HistoryMessage[] = [
      {
        role: "assistant",
        content: [{ type: "tool_use", toolCallId: "c1", name: "client_tool", input: {} }],
      },
      { role: "tool", toolCallId: "c1", content: "done" },
    ];
    expect(resolvePendingToolUse(messages, [clientTool])).toEqual({ client: [], server: [] });
  });

  it("returns empty if last assistant message has string content", () => {
    const messages: HistoryMessage[] = [{ role: "assistant", content: "plain" }];
    expect(resolvePendingToolUse(messages)).toEqual({ client: [], server: [] });
  });

  it("returns empty if no assistant message in history", () => {
    const messages: HistoryMessage[] = [{ role: "user", content: "hi" }];
    expect(resolvePendingToolUse(messages)).toEqual({ client: [], server: [] });
  });

  it("finds last assistant message even if not the last message", () => {
    const messages: HistoryMessage[] = [
      {
        role: "assistant",
        content: [{ type: "tool_use", toolCallId: "c1", name: "client_tool", input: {} }],
      },
      { role: "tool", toolCallId: "c1", content: "done" },
      { role: "user", content: "thanks" },
    ];
    expect(resolvePendingToolUse(messages, [clientTool])).toEqual({ client: [], server: [] });
  });

  it("returns empty when last assistant message has string content", () => {
    const messages: HistoryMessage[] = [{ role: "assistant", content: "hello" }];
    expect(resolvePendingToolUse(messages, [clientTool])).toEqual({ client: [], server: [] });
  });

  it("treats all tools as server-side when clientTools is omitted", () => {
    const messages: HistoryMessage[] = [
      {
        role: "assistant",
        content: [{ type: "tool_use", toolCallId: "c1", name: "some_tool", input: {} }],
      },
    ];
    const { client, server } = resolvePendingToolUse(messages);
    expect(client).toEqual([]);
    expect(server).toHaveLength(1);
  });
});
