import { describe, it, expect } from "vitest";
import { sseEventsToMessages, sseEventsToMessagesAsync } from "../src/utils";
import type { SSEEvent } from "../src/types";

describe("sseEventsToMessages", () => {
  it("converts text event to assistant message", () => {
    const events: SSEEvent[] = [
      { event: "turn_start" },
      { event: "text", text: "hello" },
      { event: "turn_stop", stopReason: "end_turn" },
    ];
    const [messages, stopReason] = sseEventsToMessages(events);
    expect(messages).toEqual([{ role: "assistant", content: [{ type: "text", text: "hello" }] }]);
    expect(stopReason).toBe("end_turn");
  });

  it("accumulates text_delta into text block", () => {
    const events: SSEEvent[] = [
      { event: "text_delta", delta: "hel" },
      { event: "text_delta", delta: "lo" },
      { event: "turn_stop", stopReason: "end_turn" },
    ];
    const [messages, stopReason] = sseEventsToMessages(events);
    expect(messages).toEqual([{ role: "assistant", content: [{ type: "text", text: "hello" }] }]);
    expect(stopReason).toBe("end_turn");
  });

  it("accumulates thinking_delta into thinking block", () => {
    const events: SSEEvent[] = [
      { event: "thinking_delta", delta: "thin" },
      { event: "thinking_delta", delta: "king" },
      { event: "turn_stop", stopReason: "end_turn" },
    ];
    const [messages, stopReason] = sseEventsToMessages(events);
    expect(messages).toEqual([
      { role: "assistant", content: [{ type: "thinking", thinking: "thinking" }] },
    ]);
    expect(stopReason).toBe("end_turn");
  });

  it("converts thinking event to thinking block", () => {
    const events: SSEEvent[] = [
      { event: "thinking", thinking: "deep thought" },
      { event: "turn_stop", stopReason: "end_turn" },
    ];
    const [messages, stopReason] = sseEventsToMessages(events);
    expect(messages).toEqual([
      { role: "assistant", content: [{ type: "thinking", thinking: "deep thought" }] },
    ]);
    expect(stopReason).toBe("end_turn");
  });

  it("flushes assistant message before tool_result", () => {
    const events: SSEEvent[] = [
      { event: "tool_call", toolCallId: "c1", name: "search", input: { q: "x" } },
      { event: "tool_result", toolCallId: "c1", content: "result" },
      { event: "turn_stop", stopReason: "tool_use" },
    ];
    const [messages, stopReason] = sseEventsToMessages(events);
    expect(messages).toContainEqual({
      role: "assistant",
      content: [{ type: "tool_use", toolCallId: "c1", name: "search", input: { q: "x" } }],
    });
    expect(messages).toContainEqual({ role: "tool", toolCallId: "c1", content: "result" });
    expect(stopReason).toBe("tool_use");
  });

  it("flushes delta accumulators when non-delta event arrives", () => {
    const events: SSEEvent[] = [
      { event: "text_delta", delta: "hi" },
      { event: "tool_call", toolCallId: "c1", name: "fn", input: {} },
      { event: "turn_stop", stopReason: "end_turn" },
    ];
    const [messages, stopReason] = sseEventsToMessages(events);
    const assistant = messages.find((m) => m.role === "assistant");
    expect(Array.isArray(assistant?.content) && assistant.content[0]).toEqual({
      type: "text",
      text: "hi",
    });
    expect(stopReason).toBe("end_turn");
  });

  it("returns empty array for events with no content", () => {
    const events: SSEEvent[] = [
      { event: "turn_start" },
      { event: "turn_stop", stopReason: "end_turn" },
    ];
    const [messages, stopReason] = sseEventsToMessages(events);
    expect(messages).toEqual([]);
    expect(stopReason).toBe("end_turn");
  });
});

describe("sseEventsToMessagesAsync", () => {
  async function* toAsync(events: SSEEvent[]) {
    for (const e of events) yield e;
  }

  it("converts events to messages and stopReason", async () => {
    const events: SSEEvent[] = [
      { event: "text", text: "hello" },
      { event: "turn_stop", stopReason: "end_turn" },
    ];
    const [messages, stopReason] = await sseEventsToMessagesAsync(toAsync(events));
    expect(messages).toEqual([{ role: "assistant", content: [{ type: "text", text: "hello" }] }]);
    expect(stopReason).toBe("end_turn");
  });

  it("returns empty messages for no content", async () => {
    const events: SSEEvent[] = [
      { event: "turn_start" },
      { event: "turn_stop", stopReason: "tool_use" },
    ];
    const [messages, stopReason] = await sseEventsToMessagesAsync(toAsync(events));
    expect(messages).toEqual([]);
    expect(stopReason).toBe("tool_use");
  });

  it("handles tool_result with no preceding assistant blocks", () => {
    const events: SSEEvent[] = [
      { event: "tool_result", toolCallId: "c1", content: "result" },
      { event: "turn_stop", stopReason: "tool_use" },
    ];
    const [messages] = sseEventsToMessages(events);
    expect(messages).toEqual([{ role: "tool", toolCallId: "c1", content: "result" }]);
  });
});
