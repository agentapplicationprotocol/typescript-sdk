import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { Client, Session } from "../../index.js";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3010";
const API_KEY = process.env.API_KEY ?? "";

function extractText(content: unknown): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
  return String(content);
}

const prompts = [
  "What is the capital of France?",
  "What is 12 * 8?",
  "Summarize what we discussed.",
];

async function main() {
  const client = new Client({ baseUrl: BASE_URL, apiKey: API_KEY });

  const meta = await client.getMeta();
  const agentInfo = meta.agents[0];
  if (!agentInfo) throw new Error("No agents available");

  // Prompt for agent options
  const options: Record<string, string> = {};
  if (agentInfo.options?.length) {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    for (const opt of agentInfo.options) {
      const hint = opt.type === "secret" ? "(secret)" : `default: ${opt.default}`;
      const answer = await rl.question(`${opt.title ?? opt.name} [${hint}]: `);
      if (answer) options[opt.name] = answer;
    }
    rl.close();
  }

  const { session } = await Session.create(
    client,
    {
      agent: { name: agentInfo.name, options: Object.keys(options).length ? options : undefined },
      messages: [{ role: "user", content: prompts[0] }],
    },
    agentInfo,
  );

  console.log(`\n[user] ${prompts[0]}`);
  console.log(`[assistant] ${extractText(session.history.at(-1)?.content)}\n`);

  for (const prompt of prompts.slice(1)) {
    await session.send({ messages: [{ role: "user", content: prompt }] });
    console.log(`[user] ${prompt}`);
    console.log(`[assistant] ${extractText(session.history.at(-1)?.content)}\n`);
  }
}

main().catch(console.error);
