import {
  HistoryMessage,
  ToolSpec,
  AgentResponse,
  sseEventsToMessagesAsync,
  DeltaSSEEvent,
  StopReason,
  ContentBlock,
} from "@agentapplicationprotocol/core";
import {
  FinishReason,
  generateText,
  jsonSchema,
  LanguageModel,
  ModelMessage,
  streamText,
  TextStreamPart,
  tool,
  ToolSet,
} from "ai";

/**
 * Base class for LLM backends. Subclasses must implement `stream`.
 * By default, `call` falls back to streaming mode, but overriding it with a
 * native non-streaming call is more efficient when the LLM supports it.
 */
export abstract class ModelProvider {
  /** Calls the LLM in streaming mode and yields SSE events as they arrive. */
  abstract stream(history: HistoryMessage[], tools: ToolSpec[]): AsyncIterable<DeltaSSEEvent>;

  /** Calls the LLM in non-streaming mode and returns a complete AgentResponse. Falls back to streaming if not overridden. */
  async call(history: HistoryMessage[], tools: ToolSpec[]): Promise<AgentResponse> {
    const [messages, stopReason] = await sseEventsToMessagesAsync(this.stream(history, tools));
    return { messages, stopReason };
  }
}

/**
 * Converts AAP `HistoryMessage[]` to the AI SDK message format.
 * Multi-block assistant messages are mapped to `content` arrays;
 * tool results are wrapped in the AI SDK `tool-result` shape.
 * Image blocks in user messages are converted to AI SDK image parts
 * (URL objects for `https://` links, base64 strings for `data:` URIs).
 */
export function toAiMessages(messages: HistoryMessage[]): ModelMessage[] {
  // Build a lookup map from toolCallId to tool name from all assistant messages
  const toolNameById = new Map<string, string>();
  for (const m of messages) {
    if (m.role === "assistant" && Array.isArray(m.content)) {
      for (const b of m.content) {
        if (b.type === "tool_use") toolNameById.set(b.toolCallId, b.name);
      }
    }
  }

  return messages.flatMap((m): ModelMessage[] => {
    if (m.role === "system") return [{ role: "system", content: m.content }];
    if (m.role === "user") {
      if (typeof m.content === "string") return [{ role: "user", content: m.content }];
      const parts = m.content.map((b) => {
        if (b.type === "text") return { type: "text", text: b.text };
        if (b.type === "image") {
          if (b.url.startsWith("data:")) {
            const [header, data] = b.url.slice(5).split(",");
            const mediaType = header.replace(";base64", "");
            return { type: "image", image: data, mediaType };
          }
          return { type: "image", image: new URL(b.url) };
        }
        return { type: "text", text: JSON.stringify(b) }; // fallback for unknown block types
      });
      return [{ role: "user", content: parts } as ModelMessage];
    }
    if (m.role === "assistant") {
      if (typeof m.content === "string") return [{ role: "assistant", content: m.content }];
      const parts = m.content.map((b) => {
        if (b.type === "text") return { type: "text", text: b.text };
        if (b.type === "thinking") return { type: "reasoning", text: b.thinking };
        if (b.type === "tool_use")
          return {
            type: "tool-call",
            toolCallId: b.toolCallId,
            toolName: b.name,
            input: b.input,
          };
        return { type: "text", text: JSON.stringify(b) }; // fallback for unknown block types
      });
      return [{ role: "assistant", content: parts } as ModelMessage];
    }
    if (m.role === "tool") {
      const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      return [
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: m.toolCallId,
              toolName: toolNameById.get(m.toolCallId) ?? "",
              output: { type: "text", value: content },
            },
          ],
        } as ModelMessage,
      ];
    }
    return []; // skip unknown roles
  });
}

/** Maps an AI SDK `finishReason` string to an AAP `StopReason`. */
export function fromAiFinishReason(reason: FinishReason): StopReason {
  if (reason === "tool-calls") return "tool_use";
  if (reason === "length") return "max_tokens";
  if (reason === "content-filter") return "refusal";
  if (reason === "error") return "error";
  return "end_turn";
}

/** Converts an AI SDK `TextStreamPart` to an AAP `DeltaSSEEvent`, or `undefined` for irrelevant part types. */
export function fromAiStreamPart(part: TextStreamPart<ToolSet>): DeltaSSEEvent | undefined {
  if (part.type === "text-delta") {
    return { event: "text_delta" as const, delta: part.text };
  } else if (part.type === "reasoning-delta") {
    return { event: "thinking_delta" as const, delta: part.text };
  } else if (part.type === "tool-call") {
    return {
      event: "tool_call" as const,
      toolCallId: part.toolCallId,
      name: part.toolName,
      input: part.input as Record<string, unknown>,
    };
  } else if (part.type === "finish") {
    return {
      event: "turn_stop",
      stopReason: fromAiFinishReason(part.finishReason),
    };
  }
}

/** Converts AI SDK `ModelMessage[]` to AAP `HistoryMessage[]`. */
export function fromAiMessages(messages: ModelMessage[]): HistoryMessage[] {
  return messages.flatMap((m): HistoryMessage[] => {
    if (m.role === "system") return [{ role: "system", content: m.content }];
    if (m.role === "user") {
      if (typeof m.content === "string") return [{ role: "user", content: m.content }];
      const content = m.content.flatMap((b): ContentBlock[] => {
        if (b.type === "text") return [{ type: "text", text: b.text }];
        if (b.type === "image") {
          const url =
            b.image instanceof URL
              ? b.image.href
              : `data:${b.mediaType ?? "image/png"};base64,${b.image}`;
          return [{ type: "image", url }];
        }
        return [];
      });
      return [{ role: "user", content }];
    }
    if (m.role === "assistant") {
      if (typeof m.content === "string") return [{ role: "assistant", content: m.content }];
      const content = m.content.flatMap((b): ContentBlock[] => {
        if (b.type === "text") return [{ type: "text", text: b.text }];
        if (b.type === "reasoning") return [{ type: "thinking", thinking: b.text }];
        if (b.type === "tool-call")
          return [
            {
              type: "tool_use",
              toolCallId: b.toolCallId,
              name: b.toolName,
              input: b.input as Record<string, unknown>,
            },
          ];
        return [];
      });
      return [{ role: "assistant", content }];
    }
    if (m.role === "tool") {
      return m.content.flatMap((b): HistoryMessage[] => {
        if (b.type !== "tool-result") return [];
        const content = b.output.type === "text" ? b.output.value : JSON.stringify(b.output);
        return [{ role: "tool", toolCallId: b.toolCallId, content }];
      });
    }
    return []; // skip unknown roles
  });
}

export function toAiToolSet(tools: ToolSpec[]): ToolSet {
  const res: ToolSet = {};
  for (const t of tools) {
    res[t.name] = tool({
      description: t.description,
      inputSchema: jsonSchema(t.parameters),
    });
  }
  return res;
}

/** `ModelProvider` implementation backed by any Vercel AI SDK `LanguageModel`. */
export class AiModelProvider extends ModelProvider {
  constructor(public model: LanguageModel) {
    super();
  }

  async *stream(history: HistoryMessage[], tools: ToolSpec[]) {
    const result = streamText({
      model: this.model,
      tools: toAiToolSet(tools),
      messages: toAiMessages(history),
    });

    for await (const part of result.fullStream) {
      const e = fromAiStreamPart(part);
      if (e !== undefined) {
        yield e;
      }
    }
  }

  async call(history: HistoryMessage[], tools: ToolSpec[]): Promise<AgentResponse> {
    const res = await generateText({
      model: this.model,
      tools: toAiToolSet(tools),
      messages: toAiMessages(history),
    });
    return {
      messages: fromAiMessages(res.response.messages),
      stopReason: fromAiFinishReason(res.finishReason),
    };
  }
}
