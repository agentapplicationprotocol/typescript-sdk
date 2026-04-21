import { describe, it, expect } from "vitest";
import { Agent } from "./agent";
import z from "zod";

describe("Agent", () => {
  it("initializes with name and defaults", () => {
    const agent = new Agent("my-agent");
    expect(agent.info.name).toBe("my-agent");
    expect(agent.info.version).toBe("1.0.0");
    expect(agent.info.tools).toEqual([]);
    expect(agent.tools.size).toBe(0);
  });

  it("accepts title, description, version options", () => {
    const agent = new Agent("a", { title: "T", description: "D", version: "2.0.0" });
    expect(agent.info.title).toBe("T");
    expect(agent.info.description).toBe("D");
    expect(agent.info.version).toBe("2.0.0");
  });

  it("option() adds an option and returns this", () => {
    const agent = new Agent("a");
    const result = agent.option({ type: "text", name: "model", default: "gpt-4" });
    expect(result).toBe(agent);
    expect(agent.info.options).toHaveLength(1);
    expect(agent.info.options![0].name).toBe("model");
  });

  it("initializes with no capabilities by default", () => {
    const agent = new Agent("my-agent");
    expect(agent.info.capabilities).toBeUndefined();
  });

  it("stream() sets stream capability and returns this", () => {
    const agent = new Agent("a");
    const result = agent.stream({ delta: {}, message: {}, none: {} });
    expect(result).toBe(agent);
    expect(agent.info.capabilities?.stream).toEqual({ delta: {}, message: {}, none: {} });
  });

  it("application() sets application capability and returns this", () => {
    const agent = new Agent("a");
    const result = agent.application({ tools: {} });
    expect(result).toBe(agent);
    expect(agent.info.capabilities?.application).toEqual({ tools: {} });
  });

  it("image() sets image capability and returns this", () => {
    const agent = new Agent("a");
    const result = agent.image({ http: {} });
    expect(result).toBe(agent);
    expect(agent.info.capabilities?.image).toEqual({ http: {} });
  });

  it("history() sets history capability and returns this", () => {
    const agent = new Agent("a");
    const result = agent.history({});
    expect(result).toBe(agent);
    expect(agent.info.capabilities?.history).toEqual({});
  });

  it("tool() registers tool spec and executor", async () => {
    const agent = new Agent("a");
    agent.tool(
      "add",
      {
        description: "adds two numbers",
        inputSchema: z.object({ a: z.number(), b: z.number() }),
        outputSchema: z.number(),
      },
      async ({ a, b }) => a + b,
    );

    expect(agent.info.tools).toHaveLength(1);
    expect(agent.info.tools![0].name).toBe("add");
    expect(agent.tools.has("add")).toBe(true);

    const result = await agent.tools.get("add")!(JSON.stringify({ a: 2, b: 3 }));
    expect(JSON.parse(result)).toBe(5);
  });

  it("tool() excludes $schema from parameters", () => {
    const agent = new Agent("a");
    agent.tool("t", { inputSchema: z.object({ x: z.string() }) }, async () => null);
    expect(agent.info.tools![0].parameters).not.toHaveProperty("$schema");
  });

  it("tool() validates output with outputSchema", async () => {
    const agent = new Agent("a");
    agent.tool(
      "greet",
      { inputSchema: z.object({ name: z.string() }), outputSchema: z.string() },
      async ({ name }) => `hello ${name}`,
    );
    const result = await agent.tools.get("greet")!(JSON.stringify({ name: "world" }));
    expect(JSON.parse(result)).toBe("hello world");
  });
});
