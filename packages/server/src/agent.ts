import {
  AgentCapabilities,
  AgentInfo,
  AgentOption,
  ToolRegistry,
} from "@agentapplicationprotocol/core";
import z from "zod";

/** Defines an AAP agent: its metadata, capabilities, options, and tools. Use the fluent builder methods to configure, then pass to `Session`. */
export class Agent {
  private _info: Omit<AgentInfo, "tools">;
  readonly registry: ToolRegistry = new ToolRegistry();

  constructor(name: string, options?: { title?: string; description?: string; version?: string }) {
    this._info = {
      name,
      title: options?.title,
      description: options?.description,
      version: options?.version ?? "1.0.0",
      options: [],
    };
  }

  /** Returns the full AgentInfo, deriving tools from the registry. */
  get info(): AgentInfo {
    return { ...this._info, tools: this.registry.tools };
  }

  /** Declares a configurable agent option (text, secret, or select). */
  option(opt: AgentOption): Agent {
    this._info.options ??= [];
    this._info.options.push(opt);
    return this;
  }

  /** Declares supported stream modes. */
  stream(modes: AgentCapabilities["stream"]): Agent {
    this._info.capabilities ??= {};
    this._info.capabilities.stream = modes;
    return this;
  }

  /** Declares application-provided input capabilities (e.g. client-side tools). */
  application(application: AgentCapabilities["application"]): Agent {
    this._info.capabilities ??= {};
    this._info.capabilities.application = application;
    return this;
  }

  /** Declares image input capability. */
  image(image: AgentCapabilities["image"]): Agent {
    this._info.capabilities ??= {};
    this._info.capabilities.image = image;
    return this;
  }

  /** Declares history retrieval capability. */
  history(history: AgentCapabilities["history"]): Agent {
    this._info.capabilities ??= {};
    this._info.capabilities.history = history;
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
    this.registry.register(name, options, exec);
    return this;
  }
}
