#!/usr/bin/env node
/**
 * Interactive demo driver for the Champions DeepAgent.
 *
 *   npm run demo
 *   node demo.mjs "Build me a bulky Annihilape for this team."
 *
 * Model comes from buildChampionsAgent (model option -> CHAMPIONS_MODEL ->
 * deepseek:deepseek-chat when DEEPSEEK_API_KEY is set -> openai:gpt-5.5).
 */
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { buildChampionsAgent } from "./dist/index.js";
import { Command } from "@langchain/langgraph";

const prompt = process.argv[2] ?? "Build me a bulky Annihilape for this team.";

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

const agent = await buildChampionsAgent({});

const config = {
  configurable: { thread_id: "demo", userId: "demo-user" },
  context: { userId: "demo-user" },
};

console.log(`\n> ${prompt}\n`);

let result = await agent.invoke(
  { messages: [{ role: "user", content: prompt }] },
  config,
);

// save_set interrupts for human approval (S-8). Prompt, then resume on the
// same thread_id.
while (result?.__interrupt__?.length) {
  for (const interrupt of result.__interrupt__) {
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
    result = await agent.invoke(new Command({ resume: { decisions } }), config);
  }
}

printMessage(result.messages?.at(-1));
rl.close();
