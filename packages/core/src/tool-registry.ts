import z from "zod";
import type { ToolCall, ToolSpec, JSONSchema } from "./types/tools.js";
import type { ToolMessage } from "./types/messages.js";

/** Stores tool specs and their raw-JSON-string executors. */
export class ToolRegistry {
  private specs: ToolSpec[] = [];
  private executors: Map<string, (input: string) => Promise<string>> = new Map();

  register<I, O>(
    name: string,
    options: {
      title?: string;
      description?: string;
      inputSchema: z.ZodType<I>;
      outputSchema?: z.ZodType<O>;
    },
    exec: (input: I) => Promise<O>,
  ): void {
    this.specs.push({
      name,
      title: options.title,
      description: options.description ?? "",
      parameters: (({ $schema, ...rest }) => rest)(
        z.toJSONSchema(options.inputSchema),
      ) as JSONSchema,
    });
    this.executors.set(name, async (input: string) => {
      const output = await exec(options.inputSchema.parse(JSON.parse(input)));
      return JSON.stringify(options.outputSchema ? options.outputSchema.parse(output) : output);
    });
  }

  get tools(): ToolSpec[] {
    return this.specs;
  }

  /** Executes a tool call and returns a ToolMessage.
   * If the tool is not registered or execution fails, returns a ToolMessage with the error as content instead of throwing. */
  async exec(call: ToolCall): Promise<ToolMessage> {
    const executor = this.executors.get(call.name);
    if (!executor)
      return { role: "tool", toolCallId: call.toolCallId, content: `Tool not found: ${call.name}` };
    try {
      const content = await executor(JSON.stringify(call.input));
      return { role: "tool", toolCallId: call.toolCallId, content };
    } catch (e) {
      return {
        role: "tool",
        toolCallId: call.toolCallId,
        content: `Tool execution failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }
}
