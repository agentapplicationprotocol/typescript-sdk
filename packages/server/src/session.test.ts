import { describe, it, expect, vi } from "vitest";
import { Session } from "./session";
import { Agent } from "./agent";
import { ModelProvider } from "./model";
import type {
  AgentConfig,
  PostSessionTurnResponse,
  DeltaSSEEvent,
  HistoryMessage,
  SSEEvent,
} from "@agentapplicationprotocol/core";
import z from "zod";

function makeModel(overrides: Partial<ModelProvider> = {}): ModelProvider {
  return {
    stream: vi.fn(async function* () {
      yield { event: "text_delta" as const, delta: "hi" };
      yield { event: "turn_stop" as const, stopReason: "end_turn" as const };
    }),
    call: vi.fn().mockResolvedValue({
      stopReason: "end_turn",
      messages: [{ role: "assistant", content: "hi" }],
    } satisfies PostSessionTurnResponse),
    ...overrides,
  } as unknown as ModelProvider;
}

function makeAgent(): Agent {
  const agent = new Agent("test-agent");
  agent.tool("echo", { inputSchema: z.object({ msg: z.string() }) }, async ({ msg }) => msg);
  return agent;
}

function makeSession(
  agentConfig: AgentConfig = { name: "test-agent" },
  model = makeModel(),
  agent = makeAgent(),
) {
  return new Session("sess-1", agent, model, agentConfig, [], []);
}

const userMsg: HistoryMessage = { role: "user", content: "hello" };

describe("Session", () => {
  it("initializes with empty history and clientTools", () => {
    const s = makeSession();
    expect(s.sessionId).toBe("sess-1");
    expect(s.history).toEqual([]);
    expect(s.clientTools).toEqual([]);
  });

  it("toSessionResponse returns sessionId and agentConfig", () => {
    const s = makeSession({ name: "test-agent", options: { model: "gpt-4" } });
    expect(s.toSessionResponse()).toEqual({
      sessionId: "sess-1",
      agent: { name: "test-agent", options: { model: "gpt-4" } },
    });
  });

  it("toSessionResponse includes tools when clientTools is set", () => {
    const s = makeSession();
    s.clientTools = [{ name: "t", description: "", parameters: {} }];
    expect(s.toSessionResponse().tools).toHaveLength(1);
  });

  describe("runTurn (none mode)", () => {
    it("calls model and accumulates history", async () => {
      const s = makeSession();
      const res = (await s.runTurn({ messages: [userMsg] })) as PostSessionTurnResponse;
      expect(res).toEqual({
        stopReason: "end_turn",
        messages: [{ role: "assistant", content: "hi" }],
      });
      expect(s.history).toHaveLength(2); // user + assistant
    });

    it("executes trusted tools inline and loops", async () => {
      const agent = makeAgent();
      const agentConfig: AgentConfig = {
        name: "test-agent",
        tools: [{ name: "echo", trust: true }],
      };
      // First call returns tool_use, second returns end_turn
      const model = makeModel({
        call: vi
          .fn()
          .mockResolvedValueOnce({
            stopReason: "tool_use",
            messages: [
              {
                role: "assistant",
                content: [
                  { type: "tool_use", toolCallId: "c1", name: "echo", input: { msg: "hi" } },
                ],
              },
            ],
          })
          .mockResolvedValueOnce({
            stopReason: "end_turn",
            messages: [{ role: "assistant", content: "done" }],
          }),
      });
      const s = new Session("s", agent, model, agentConfig, [], []);
      const res = await (s.runTurn({ messages: [userMsg] }) as Promise<PostSessionTurnResponse>);
      expect(res.stopReason).toBe("end_turn");
      expect(model.call).toHaveBeenCalledTimes(2);
    });

    it("stops and returns tool_use when tool is untrusted", async () => {
      const agent = makeAgent();
      const agentConfig: AgentConfig = {
        name: "test-agent",
        tools: [{ name: "echo", trust: false }],
      };
      const model = makeModel({
        call: vi.fn().mockResolvedValue({
          stopReason: "tool_use",
          messages: [
            {
              role: "assistant",
              content: [{ type: "tool_use", toolCallId: "c1", name: "echo", input: { msg: "hi" } }],
            },
          ],
        }),
      });
      const s = new Session("s", agent, model, agentConfig, [], []);
      const res = (await s.runTurn({ messages: [userMsg] })) as PostSessionTurnResponse;
      expect(res.stopReason).toBe("tool_use");
      expect(model.call).toHaveBeenCalledTimes(1);
    });
  });

  describe("runTurn (delta mode)", () => {
    it("yields turn_start and turn_stop events", async () => {
      const s = makeSession();
      const result = s.runTurn({ messages: [userMsg], stream: "delta" });
      const events = [];
      for await (const e of result as AsyncIterable<DeltaSSEEvent>) events.push(e);
      expect(events[0].event).toBe("turn_start");
      expect(events.at(-1)!.event).toBe("turn_stop");
    });

    it("yields turn_stop with error stopReason when model.stream throws", async () => {
      const model = makeModel({
        stream: vi.fn().mockImplementationOnce(async function* () {
          throw new Error("model failure");
        }),
      });
      const s = makeSession({ name: "test-agent" }, model);
      const events = [];
      for await (const e of s.runTurn({
        messages: [userMsg],
        stream: "delta",
      }) as AsyncIterable<DeltaSSEEvent>)
        events.push(e);
      const last = events.at(-1)!;
      expect(last.event).toBe("turn_stop");
      expect((last as any).stopReason).toBe("error");
    });

    it("executes trusted tools inline and loops in delta mode", async () => {
      const agent = makeAgent();
      const agentConfig: AgentConfig = {
        name: "test-agent",
        tools: [{ name: "echo", trust: true }],
      };
      const model = makeModel({
        stream: vi
          .fn()
          .mockImplementationOnce(async function* () {
            yield {
              event: "tool_call" as const,
              toolCallId: "c1",
              name: "echo",
              input: { msg: "hi" },
            };
            yield { event: "turn_stop" as const, stopReason: "tool_use" as const };
          })
          .mockImplementationOnce(async function* () {
            yield { event: "text_delta" as const, delta: "done" };
            yield { event: "turn_stop" as const, stopReason: "end_turn" as const };
          }),
      });
      const s = new Session("s", agent, model, agentConfig, [], []);
      const events = [];
      for await (const e of s.runTurn({
        messages: [userMsg],
        stream: "delta",
      }) as AsyncIterable<DeltaSSEEvent>) {
        events.push(e);
      }
      expect(events.some((e) => e.event === "tool_result")).toBe(true);
      expect(model.stream).toHaveBeenCalledTimes(2);
    });
  });

  describe("runTurn (message mode)", () => {
    it("yields turn_start, text, and turn_stop events", async () => {
      const s = makeSession();
      const result = s.runTurn({ messages: [userMsg], stream: "message" });
      const events = [];
      for await (const e of result as AsyncIterable<SSEEvent>) events.push(e);
      expect(events[0].event).toBe("turn_start");
      expect(events.some((e) => e.event === "text")).toBe(true);
      expect(events.at(-1)!.event).toBe("turn_stop");
    });

    it("yields thinking event for thinking blocks", async () => {
      const model = makeModel({
        call: vi.fn().mockResolvedValue({
          stopReason: "end_turn",
          messages: [{ role: "assistant", content: [{ type: "thinking", thinking: "hmm" }] }],
        }),
      });
      const s = makeSession({ name: "test-agent" }, model);
      const events = [];
      for await (const e of s.runTurn({
        messages: [userMsg],
        stream: "message",
      }) as AsyncIterable<SSEEvent>) {
        events.push(e);
      }
      expect(events.some((e) => e.event === "thinking")).toBe(true);
    });

    it("executes trusted tools inline and loops in message mode", async () => {
      const agent = makeAgent();
      const agentConfig: AgentConfig = {
        name: "test-agent",
        tools: [{ name: "echo", trust: true }],
      };
      const model = makeModel({
        call: vi
          .fn()
          .mockResolvedValueOnce({
            stopReason: "tool_use",
            messages: [
              {
                role: "assistant",
                content: [
                  { type: "tool_use", toolCallId: "c1", name: "echo", input: { msg: "hi" } },
                ],
              },
            ],
          })
          .mockResolvedValueOnce({
            stopReason: "end_turn",
            messages: [{ role: "assistant", content: "done" }],
          }),
      });
      const s = new Session("s", agent, model, agentConfig, [], []);
      const events = [];
      for await (const e of s.runTurn({
        messages: [userMsg],
        stream: "message",
      }) as AsyncIterable<SSEEvent>) {
        events.push(e);
      }
      expect(events.some((e) => e.event === "tool_result")).toBe(true);
      expect(model.call).toHaveBeenCalledTimes(2);
    });
  });

  describe("runTurn with tool_permission", () => {
    it("resolves granted tool_permission into tool result", async () => {
      const agent = makeAgent();
      const agentConfig: AgentConfig = { name: "test-agent" };
      // Seed history with an assistant message containing a tool_use
      const model = makeModel();
      const s = new Session("s", agent, model, agentConfig, [], []);
      s.history = [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: [{ type: "tool_use", toolCallId: "c1", name: "echo", input: { msg: "hello" } }],
        },
      ];
      await s.runTurn({
        messages: [{ role: "tool_permission", toolCallId: "c1", granted: true }],
      });
      // model.call should have received a tool result message
      const callArg = (model.call as ReturnType<typeof vi.fn>).mock.calls[0][0] as HistoryMessage[];
      const toolResult = callArg.find((m) => m.role === "tool");
      expect(toolResult).toBeDefined();
      expect((toolResult as any).content).toBe('"hello"');
    });

    it("resolves denied tool_permission with denial message", async () => {
      const agent = makeAgent();
      const model = makeModel();
      const s = new Session("s", agent, model, { name: "test-agent" }, [], []);
      s.history = [
        {
          role: "assistant",
          content: [{ type: "tool_use", toolCallId: "c2", name: "echo", input: { msg: "x" } }],
        },
      ];
      await s.runTurn({
        messages: [{ role: "tool_permission", toolCallId: "c2", granted: false, reason: "no" }],
      });
      const callArg = (model.call as ReturnType<typeof vi.fn>).mock.calls[0][0] as HistoryMessage[];
      const toolResult = callArg.find((m) => m.role === "tool");
      expect((toolResult as any).content).toBe("Tool use denied: no");
    });
  });

  describe("applySessionOverrides via runTurn", () => {
    it("overrides clientTools when req.tools is provided", async () => {
      const s = makeSession();
      const newTool = { name: "x", description: "", parameters: {} };
      await s.runTurn({ messages: [userMsg], tools: [newTool] });
      expect(s.clientTools).toEqual([newTool]);
    });

    it("overrides agentConfig.tools when req.agent.tools is provided", async () => {
      const s = makeSession();
      await s.runTurn({ messages: [userMsg], agent: { tools: [{ name: "echo", trust: true }] } });
      expect(s.agentConfig.tools).toEqual([{ name: "echo", trust: true }]);
    });

    it("overrides agentConfig.options when req.agent.options is provided", async () => {
      const s = makeSession({ name: "test-agent", options: { model: "gpt-4" } });
      await s.runTurn({ messages: [userMsg], agent: { options: { model: "gpt-5" } } });
      expect(s.agentConfig.options).toEqual({ model: "gpt-5" });
    });
  });

  describe("runTurn (delta mode) — untrusted tool stops loop", () => {
    it("stops at untrusted tool in delta mode", async () => {
      const agent = makeAgent();
      const agentConfig: AgentConfig = { name: "test-agent", tools: [] }; // echo not trusted
      const model = makeModel({
        stream: vi.fn().mockImplementationOnce(async function* () {
          yield {
            event: "tool_call" as const,
            toolCallId: "c1",
            name: "echo",
            input: { msg: "hi" },
          };
          yield { event: "turn_stop" as const, stopReason: "tool_use" as const };
        }),
      });
      const s = new Session("s", agent, model, agentConfig, [], []);
      const events = [];
      for await (const e of s.runTurn({
        messages: [userMsg],
        stream: "delta",
      }) as AsyncIterable<DeltaSSEEvent>)
        events.push(e);
      expect(events.at(-1)!.event).toBe("turn_stop");
      expect(model.stream).toHaveBeenCalledTimes(1);
    });
  });

  describe("runTurn (message mode) — tool_use block and untrusted stop", () => {
    it("yields tool_call event for tool_use blocks in message mode", async () => {
      const model = makeModel({
        call: vi.fn().mockResolvedValue({
          stopReason: "tool_use",
          messages: [
            {
              role: "assistant",
              content: [{ type: "tool_use", toolCallId: "c1", name: "echo", input: { msg: "hi" } }],
            },
          ],
        }),
      });
      const s = makeSession({ name: "test-agent" }, model);
      const events = [];
      for await (const e of s.runTurn({
        messages: [userMsg],
        stream: "message",
      }) as AsyncIterable<SSEEvent>)
        events.push(e);
      expect(events.some((e) => e.event === "tool_call")).toBe(true);
    });

    it("stops at untrusted tool in message mode", async () => {
      const agent = makeAgent();
      const agentConfig: AgentConfig = { name: "test-agent", tools: [] };
      const model = makeModel({
        call: vi.fn().mockResolvedValue({
          stopReason: "tool_use",
          messages: [
            {
              role: "assistant",
              content: [{ type: "tool_use", toolCallId: "c1", name: "echo", input: { msg: "hi" } }],
            },
          ],
        }),
      });
      const s = new Session("s", agent, model, agentConfig, [], []);
      const events = [];
      for await (const e of s.runTurn({
        messages: [userMsg],
        stream: "message",
      }) as AsyncIterable<SSEEvent>)
        events.push(e);
      expect(events.at(-1)!.event).toBe("turn_stop");
      expect(model.call).toHaveBeenCalledTimes(1);
    });
  });

  describe("lastToolUses", () => {
    it("returns empty array when last assistant message has string content", async () => {
      const s = makeSession();
      s.history = [{ role: "assistant", content: "hello" }];
      // runTurnNone will call lastToolUses; with string content it should return []
      const model = makeModel({
        call: vi.fn().mockResolvedValue({ stopReason: "end_turn", messages: [] }),
      });
      const s2 = new Session(
        "s",
        makeAgent(),
        model,
        { name: "test-agent" },
        [],
        [{ role: "assistant", content: "hello" }],
      );
      const res = (await s2.runTurn({ messages: [userMsg] })) as PostSessionTurnResponse;
      expect(res.stopReason).toBe("end_turn");
    });
  });
});
