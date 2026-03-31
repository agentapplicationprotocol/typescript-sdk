import { AgentInfo, AgentOption, JSONSchema } from "@agentapplicationprotocol/core";
import z from "zod";

export class Agent {
  info: AgentInfo;
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

  option(opt: AgentOption): Agent {
    this.info.options ??= [];
    this.info.options.push(opt);
    return this;
  }

  image(image: NonNullable<AgentInfo["capabilities"]>["image"]): Agent {
    this.info.capabilities ??= {};
    this.info.capabilities.image = image;
    return this;
  }

  history(history: NonNullable<AgentInfo["capabilities"]>["history"]): Agent {
    this.info.capabilities ??= {};
    this.info.capabilities.history = history;
    return this;
  }

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
      inputSchema: z.toJSONSchema(options.inputSchema) as JSONSchema,
    });
    this.tools.set(name, async (input: string) => {
      const output = await exec(options.inputSchema.parse(JSON.parse(input)));
      return JSON.stringify(options.outputSchema ? options.outputSchema.parse(output) : output);
    });
    return this;
  }
}
