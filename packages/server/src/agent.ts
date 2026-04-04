import { AgentInfo, AgentOption, JSONSchema } from "@agentapplicationprotocol/core";
import z from "zod";

/** Defines an AAP agent: its metadata, capabilities, options, and tools. Use the fluent builder methods to configure, then pass to `Session`. */
export class Agent {
  info: AgentInfo;
  /** Registered tool executors keyed by tool name. Values accept raw JSON string input and return raw JSON string output. */
  tools: Map<string, (input: string) => Promise<string>> = new Map();

  constructor(name: string, options?: { title?: string; description?: string; version?: string }) {
    this.info = {
      name,
      title: options?.title,
      description: options?.description,
      version: options?.version ?? "1.0.0",
      tools: [],
      options: [],
      capabilities: {
        stream: {
          delta: {},
          message: {},
          none: {},
        },
        application: {
          tools: {},
        },
      },
    };
  }

  /** Declares a configurable agent option (text, secret, or select). */
  option(opt: AgentOption): Agent {
    this.info.options ??= [];
    this.info.options.push(opt);
    return this;
  }

  /** Declares image input capability. */
  image(image: NonNullable<AgentInfo["capabilities"]>["image"]): Agent {
    this.info.capabilities ??= {};
    this.info.capabilities.image = image;
    return this;
  }

  /** Declares history retrieval capability. */
  history(history: NonNullable<AgentInfo["capabilities"]>["history"]): Agent {
    this.info.capabilities ??= {};
    this.info.capabilities.history = history;
    return this;
  }

  /**
   * Registers a tool with typed input/output schemas and an async executor.
   * The executor receives parsed input and its return value is JSON-serialized.
   * If `outputSchema` is provided, the output is validated before serialization.
   */
  tool<I, O>(
    name: string,
    options: {
      title?: string;
      description?: string;
      inputSchema: z.ZodType<I>;
      outputSchema?: z.ZodType<O>;
    },
    exec: (input: I) => Promise<O>,
  ): Agent {
    this.info.tools ??= [];
    this.info.tools.push({
      name,
      title: options.title,
      description: options.description ?? "",
      parameters: z.toJSONSchema(options.inputSchema) as JSONSchema,
    });
    this.tools.set(name, async (input: string) => {
      const output = await exec(options.inputSchema.parse(JSON.parse(input)));
      return JSON.stringify(options.outputSchema ? options.outputSchema.parse(output) : output);
    });
    return this;
  }
}
