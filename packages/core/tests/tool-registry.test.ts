import { describe, it, expect } from "vitest";
import z from "zod";
import { ToolRegistry } from "../src/tool-registry";

describe("ToolRegistry", () => {
  it("registers a tool and exposes it in tools", () => {
    const registry = new ToolRegistry();
    registry.register(
      "add",
      { inputSchema: z.object({ a: z.number(), b: z.number() }) },
      async ({ a, b }) => a + b,
    );
    expect(registry.tools).toHaveLength(1);
    expect(registry.tools[0].name).toBe("add");
  });

  it("executes a registered tool", async () => {
    const registry = new ToolRegistry();
    registry.register(
      "add",
      { inputSchema: z.object({ a: z.number(), b: z.number() }) },
      async ({ a, b }) => a + b,
    );
    const result = await registry.exec({ name: "add", toolCallId: "1", input: { a: 2, b: 3 } });
    expect(result).toEqual({ role: "tool", toolCallId: "1", content: "5" });
  });

  it("returns error message for unknown tool", async () => {
    const registry = new ToolRegistry();
    const result = await registry.exec({ name: "unknown", toolCallId: "2", input: {} });
    expect(result.content).toContain("Tool not found: unknown");
  });

  it("returns error message when execution throws", async () => {
    const registry = new ToolRegistry();
    registry.register("fail", { inputSchema: z.object({}) }, async () => {
      throw new Error("boom");
    });
    const result = await registry.exec({ name: "fail", toolCallId: "3", input: {} });
    expect(result.content).toContain("boom");
  });

  it("validates input with outputSchema", async () => {
    const registry = new ToolRegistry();
    registry.register(
      "greet",
      {
        inputSchema: z.object({ name: z.string() }),
        outputSchema: z.object({ message: z.string() }),
      },
      async ({ name }) => ({ message: `hello ${name}` }),
    );
    const result = await registry.exec({
      name: "greet",
      toolCallId: "4",
      input: { name: "world" },
    });
    expect(result.content).toBe(JSON.stringify({ message: "hello world" }));
  });
});
