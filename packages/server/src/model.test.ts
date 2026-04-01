import { describe, it, expect, vi } from "vitest";
import { ModelProvider, AiModelProvider } from "./model";
import type { HistoryMessage, DeltaSSEEvent } from "@agentapplicationprotocol/core";
import type { LanguageModel } from "ai";

// --- ModelProvider base class ---

class ConcreteModel extends ModelProvider {
  async *stream(_history: HistoryMessage[]): AsyncIterable<DeltaSSEEvent> {
    yield { event: "text_delta", delta: "hello" };
    yield { event: "turn_stop", stopReason: "end_turn" };
  }
}

describe("ModelProvider", () => {
  it("call() falls back to stream() and returns AgentResponse", async () => {
    const model = new ConcreteModel();
    const res = await model.call([{ role: "user", content: "hi" }], []);
    expect(res.stopReason).toBe("end_turn");
    expect(res.messages).toHaveLength(1);
    expect(res.messages[0]).toMatchObject({ role: "assistant" });
  });
});

// --- AiModelProvider ---

type MockLM = LanguageModel & {
  doStream: ReturnType<typeof vi.fn>;
  doGenerate: ReturnType<typeof vi.fn>;
};

function makeLM(): MockLM {
  return {
    specificationVersion: "v2",
    provider: "test",
    modelId: "test-model",
    defaultObjectGenerationMode: undefined,
    doStream: vi.fn(),
    doGenerate: vi.fn(),
  } as unknown as MockLM;
}

function mockStream(lm: MockLM, chunks: object[]) {
  lm.doStream.mockResolvedValue({
    stream: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
    rawValue: {},
    warnings: [],
  } as any);
}

function mockGenerate(lm: MockLM, finishReason: string, content: object[]) {
  lm.doGenerate.mockResolvedValue({
    finishReason,
    usage: { inputTokens: 1, outputTokens: 1 },
    content,
    rawValue: {},
    warnings: [],
    response: { id: "r1", timestamp: new Date(), modelId: "test-model", headers: {} },
  } as any);
}

describe("AiModelProvider", () => {
  it("stores the language model", () => {
    const lm = makeLM();
    expect(new AiModelProvider(lm).model).toBe(lm);
  });

  it("stream() yields text_delta and turn_stop", async () => {
    const lm = makeLM();
    mockStream(lm, [
      { type: "text-delta", id: "t1", delta: "hello", providerMetadata: undefined },
      {
        type: "finish",
        finishReason: "stop",
        usage: { inputTokens: 1, outputTokens: 1 },
        providerMetadata: undefined,
      },
    ]);
    const events: DeltaSSEEvent[] = [];
    for await (const e of new AiModelProvider(lm).stream([{ role: "user", content: "hi" }], [])) {
      events.push(e);
    }
    expect(events.some((e) => e.event === "text_delta")).toBe(true);
    expect(events.some((e) => e.event === "turn_stop")).toBe(true);
  });

  it("stream() yields thinking_delta and tool_call", async () => {
    const lm = makeLM();
    mockStream(lm, [
      { type: "reasoning-delta", id: "r1", delta: "hmm", providerMetadata: undefined },
      {
        type: "tool-call",
        toolCallId: "c1",
        toolName: "fn",
        input: { x: 1 },
        providerMetadata: undefined,
      },
      {
        type: "finish",
        finishReason: "tool-calls",
        usage: { inputTokens: 1, outputTokens: 1 },
        providerMetadata: undefined,
      },
    ]);
    const events: DeltaSSEEvent[] = [];
    for await (const e of new AiModelProvider(lm).stream([{ role: "user", content: "hi" }], [])) {
      events.push(e);
    }
    expect(events.some((e) => e.event === "thinking_delta")).toBe(true);
    expect(events.some((e) => e.event === "tool_call")).toBe(true);
    expect(events.find((e) => e.event === "turn_stop")).toMatchObject({ stopReason: "tool_use" });
  });

  it("call() returns AgentResponse with text content", async () => {
    const lm = makeLM();
    mockGenerate(lm, "stop", [{ type: "text", text: "done" }]);
    const res = await new AiModelProvider(lm).call([{ role: "user", content: "hi" }], []);
    expect(res.stopReason).toBe("end_turn");
    expect(res.messages[0].role).toBe("assistant");
  });

  it("call() maps reasoning and tool-call blocks in response", async () => {
    const lm = makeLM();
    mockGenerate(lm, "stop", [
      { type: "reasoning", text: "thinking..." },
      { type: "tool-call", toolCallId: "c1", toolName: "fn", input: { x: 1 } },
    ]);
    const res = await new AiModelProvider(lm).call([{ role: "user", content: "hi" }], []);
    const blocks = res.messages.find((m) => m.role === "assistant")!.content as any[];
    expect(blocks.some((b) => b.type === "thinking")).toBe(true);
    expect(blocks.some((b) => b.type === "tool_use")).toBe(true);
  });

  it("call() passes system, image (data URI), assistant with thinking/tool_use, and tool messages", async () => {
    const lm = makeLM();
    mockGenerate(lm, "tool-calls", [
      { type: "tool-call", toolCallId: "c1", toolName: "fn", input: { x: 1 } },
    ]);
    const history: HistoryMessage[] = [
      { role: "system", content: "be helpful" },
      { role: "user", content: [{ type: "image", url: "data:image/png;base64,abc" }] },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "hmm" },
          { type: "tool_use", toolCallId: "c1", name: "fn", input: { x: 1 } },
        ],
      },
      { role: "tool", toolCallId: "c1", content: "result" },
    ];
    const res = await new AiModelProvider(lm).call(history, []);
    expect(res.stopReason).toBe("tool_use");
  });

  it("call() maps finishReason variants correctly", async () => {
    const cases: [string, string][] = [
      ["length", "max_tokens"],
      ["content-filter", "refusal"],
      ["error", "error"],
    ];
    for (const [finishReason, expected] of cases) {
      const lm = makeLM();
      mockGenerate(lm, finishReason, []);
      const res = await new AiModelProvider(lm).call([{ role: "user", content: "hi" }], []);
      expect(res.stopReason).toBe(expected);
    }
  });
});
