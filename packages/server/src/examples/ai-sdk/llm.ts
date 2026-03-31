import {
  streamText,
  jsonSchema,
  tool,
  generateText,
  ModelMessage,
  TextStreamPart,
  FinishReason,
  ToolSet,
} from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { ModelProvider } from "../server_new.js";
import type {
  SSEEvent,
  HistoryMessage,
  StopReason,
  ToolSpec,
} from "@agentapplicationprotocol/core";

/**
 * Converts AAP `HistoryMessage[]` to the AI SDK message format.
 * Multi-block assistant messages are mapped to `content` arrays;
 * tool results are wrapped in the AI SDK `tool-result` shape.
 * Image blocks in user messages are converted to AI SDK image parts
 * (URL objects for `https://` links, base64 strings for `data:` URIs).
 */
export function toAiMessages(messages: HistoryMessage[]): ModelMessage[] {
  return messages.map((m): ModelMessage => {
    if (m.role === "system") return { role: "system", content: m.content };
    if (m.role === "user") {
      if (typeof m.content === "string") return { role: "user", content: m.content };
      const parts = m.content.map((b) => {
        if (b.type === "text") return { type: "text", text: b.text };
        if (b.type === "image") {
          if (b.url.startsWith("data:")) {
            const [header, data] = b.url.slice(5).split(",");
            const mimeType = header.replace(";base64", "");
            return { type: "image", image: data, mimeType };
          }
          return { type: "image", image: new URL(b.url) };
        }
        return { type: "text", text: JSON.stringify(b) };
      });
      return { role: "user", content: parts } as ModelMessage;
    }
    if (m.role === "assistant") {
      if (typeof m.content === "string") return { role: "assistant", content: m.content };
      const parts = m.content.map((b) => {
        if (b.type === "text") return { type: "text", text: b.text };
        if (b.type === "tool_use")
          return {
            type: "tool-call",
            toolCallId: b.toolCallId,
            toolName: b.name,
            input: b.input,
          };
        return { type: "text", text: JSON.stringify(b) };
      });
      return { role: "assistant", content: parts } as ModelMessage;
    }
    if (m.role === "tool") {
      const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      return {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: m.toolCallId,
            toolName: "",
            output: { type: "text", value: content },
          },
        ],
      } as ModelMessage;
    }
    m satisfies never;
    throw new Error("unreachable");
  });
}

/** Maps an AI SDK `finishReason` string to an AAP `StopReason`. */
export function toStopReason(reason: FinishReason): StopReason {
  if (reason === "tool-calls") return "tool_use";
  if (reason === "length") return "max_tokens";
  if (reason === "content-filter") return "refusal";
  if (reason === "error") return "error";
  return "end_turn";
}

// Re-export AI SDK functions so turn.ts can import from one place (and tests can mock them).
export { streamText, generateText };

function toAAPEvent(part: TextStreamPart<any>): SSEEvent | undefined {
  if (part.type === "text-delta") {
    return { event: "text_delta" as const, delta: part.text };
  } else if (part.type === "reasoning-delta") {
    return { event: "thinking_delta" as const, delta: part.text };
  } else if (part.type === "tool-call") {
    return {
      event: "tool_call" as const,
      toolCallId: part.toolCallId,
      name: part.toolName,
      input: JSON.stringify(part.input) as unknown as Record<string, unknown>,
    };
  } else if (part.type === "finish") {
    return {
      event: "turn_stop",
      stopReason: toStopReason(part.finishReason),
    };
  }
}

function toToolSet(tools: ToolSpec[]): ToolSet {
  const res: ToolSet = {};
  for (const t of tools) {
    res[t.name] = tool({
      description: t.description,
      inputSchema: jsonSchema(t.inputSchema),
    });
  }
  return res;
}

export class AiSDK extends ModelProvider {
  private options: Record<string, string>;

  constructor(options: Record<string, string> = {}) {
    super();
    this.options = options;
  }

  private buildModel() {
    return createOpenAI({
      baseURL: this.options.baseURL || undefined,
      apiKey: this.options.apiKey || undefined,
    })(this.options.model ?? "gpt-4o");
  }

  async *stream(history: HistoryMessage[], tools: ToolSpec[]): AsyncIterable<SSEEvent> {
    const result = streamText({
      model: this.buildModel(),
      tools: toToolSet(tools),
      messages: toAiMessages(history),
    });

    for await (const part of result.fullStream) {
      const e = toAAPEvent(part);
      if (e !== undefined) {
        yield e;
      }
    }
  }
}
