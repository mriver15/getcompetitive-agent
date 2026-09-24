#!/usr/bin/env node
/**
 * Interactive multi-turn REPL for the Champions DeepAgent.
 *
 *   npm run chat
 *
 * Keeps one thread, so conversation state (and staged proposals) persist across
 * turns. When the agent reaches save_set it pauses for approval. Type /exit to
 * quit. Model resolution is the same as buildChampionsAgent (DEEPSEEK_API_KEY
 * or CHAMPIONS_MODEL).
 */
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { buildChampionsAgent } from "./dist/index.js";
import { Command } from "@langchain/langgraph";

const agent = await buildChampionsAgent({});

const config = {
  configurable: { thread_id: "chat", userId: "demo-user" },
  context: { userId: "demo-user" },
};

const rl = readline.createInterface({ input, output });

function printMessage(message) {
  const content = message?.content;
  if (typeof content === "string") {
    console.log(`\n${content}`);
    return;
  }
  if (Array.isArray(content)) {
    const text = content
      .map((b) => (typeof b === "string" ? b : b?.text ?? ""))
      .filter(Boolean)
      .join("");
    if (text) console.log(`\n${text}`);
  }
}

async function resumeInterrupts(result) {
  let current = result;
  while (current?.__interrupt__?.length) {
    for (const interrupt of current.__interrupt__) {
      const requests = interrupt.value?.actionRequests ?? [];
      const decisions = [];
      for (const req of requests) {
        const answer = await rl.question(
          `\nApprove ${req.name} ${JSON.stringify(req.args)}? [y/N] `,
        );
        decisions.push(
          answer.trim().toLowerCase().startsWith("y")
            ? { type: "approve" }
            : { type: "reject", message: "Rejected by user." },
        );
      }
      current = await agent.invoke(new Command({ resume: { decisions } }), config);
    }
  }
  return current;
}

console.log("Champions agent chat. Type a query, or /exit.\n");

for (;;) {
  const line = (await rl.question("You> ")).trim();
  if (!line) continue;
  if (line === "/exit" || line === "/quit") break;

  let result;
  try {
    result = await agent.invoke({ messages: [{ role: "user", content: line }] }, config);
  } catch (e) {
    console.error(`\nError: ${e.message}`);
    continue;
  }

  result = await resumeInterrupts(result);
  printMessage(result.messages?.at(-1));
}

rl.close();
console.log();
