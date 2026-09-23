/**
 * LangChain / DeepAgents / LangGraph conformance reviewer.
 *
 * Registers a subagent that reviews agent code for correct use of the current
 * DeepAgents/LangChain/LangGraph APIs, per `implementation-conformance.md`.
 *
 * Two usable exports:
 *   - `conformanceSubagent`  — register on a supervisor via `subagents: [conformanceSubagent]`.
 *   - `CONFORMANCE_SKILL`    — a SKILL.md (Agent Skills spec) you can load via
 *     `createDeepAgent({ skills: [...] })` so the rules are available on demand.
 *
 * NOTE: this reviewer is a *code reviewer*. It does NOT need the project's
 * domain tools (lookup_fact, save_set, ...). Keep its tool list empty/minimal.
 */

import type { SubAgent } from "deepagents";

/** The canonical conformance rules, packaged as a progressive-disclosure skill. */
export const CONFORMANCE_SKILL = `---
name: langchain-conformance
description: >-
  Review TypeScript agent code for correct use of the DeepAgents / LangChain /
  LangGraph APIs (createDeepAgent, tool(), SubAgent/CompiledSubAgent,
  StateBackend/StoreBackend/CompositeBackend, interruptOn + checkpointer,
  createMiddleware, skills, responseFormat). Use when implementing or reviewing
  agent tools, subagents, graphs, middleware, state, or persistence for this
  project.
---

# LangChain / DeepAgents / LangGraph conformance

Follow \`implementation-conformance.md\` in the repo root. Non-negotiable checks:

1. **Tool definitions** use \`tool(fn, { name, description, schema })\` with a Zod
   schema; snake_case names (\`lookup_fact\`, \`search_dex\`, \`stage_set\`,
   \`save_set\`). Deterministic logic lives inside the tool body, never in a
   prompt.

2. **Persistence split**: \`stage_set\` writes to a thread-scoped \`StateBackend\`;
   \`save_set\` writes to a user-namespaced \`StoreBackend\`
   (\`namespace: (rt) => [rt.serverInfo.user.identity]\`). \`/sets/\` must be
   write-denied to the generic \`write_file\`/\`edit_file\` tools via
   \`permissions\` (first-match-wins).

3. **Approval** uses built-in HITL: \`interruptOn: { save_set: { allowedDecisions:
   ["approve", "reject"] } }\` plus a \`checkpointer\` (mandatory). Resume with
   \`new Command({ resume: { decisions } })\` on the same \`thread_id\`. Do NOT
   hand-roll approval control flow; do NOT put \`stage_set\` in \`interruptOn\`.

4. **Subagent allowlist**: subagent \`tools\` REPLACES inherited tools (not a
   merge). The Set Designer subagent must enumerate only
   \`lookup_fact, search_dex, calculate_damage, calculate_speed,
   optimize_spread, stage_set, read_evidence\` — never \`save_set\` or generic
   filesystem writes. Custom subagents do NOT inherit parent skills.

5. **CR-8 (only \`save_set\` persists)**: enforce via storage \`permissions\` +
   a \`doctrine-guard\` \`createMiddleware({ wrapToolCall })\` that rejects
   \`save_set\` on a non-validated sourceRef, and blocks presenting a PROPOSAL
   as measured META. An allowlist alone is insufficient (the auto
   \`general-purpose\` subagent inherits every parent tool).

6. **Structured output**: the designer emits a typed \`SetDraft\` via
   \`responseFormat\` (Zod schema), not free text.

7. **Large results** (\`search_dex\`) return explicit \`{ total, preview,
   resultRef }\`; \`expand_result\` pages from state. Do not rely on the
   harness's implicit 20k-token offloading for correctness.

8. **Custom graphs**: SetDesignerGraph is a LangGraph \`StateGraph\` with
   deterministic + model nodes, wrapped as \`CompiledSubAgent { name,
   description, runnable: graph.compile() }\`. The compiled graph must expose a
   \`messages\` state key.

9. **State**: refs only (\`ChampionsState\`); private fields prefixed \`_\`.

10. **No rejected scaffolding**: never remove \`SubAgentMiddleware\` /
    \`FilesystemMiddleware\` via \`excluded_middleware\`; use \`excluded_tools\`
    or harness-profile knobs.

Version pins: skills need \`deepagents >= 1.7.0\`; \`StoreBackend.namespace\` is
required in \`1.9.0\`; \`interruptOn\` requires a \`checkpointer\`.
`;

/** Subagent to register on a supervisor for conformance review. */
export const conformanceSubagent: SubAgent = {
  name: "langchain-conformance",
  description:
    "Reviews agent implementation for correct use of DeepAgents / LangChain / LangGraph APIs. Use when writing or reviewing agent tools, subagents, graphs, middleware, state, or persistence.",
  systemPrompt: `You are a conformance reviewer for this TypeScript project.

Your job: verify that agent code matches the current DeepAgents / LangChain /
LangGraph APIs. The authoritative rule set is \`implementation-conformance.md\`
in the repo root; the ten non-negotiable checks are reproduced in the
\`langchain-conformance\` SKILL.

Workflow:
1. Read the file(s) under review and implementation-conformance.md.
2. For each claim in the code (a tool, a subagent, a graph, middleware, state
   schema, backend routing, or an interrupt/approval path), map it to the
   correct current API.
3. Report, per finding: file:line, what the code does, what the current API
   requires, and the minimal fix. Cite the docs page (deepagents overview,
   customization, subagents, backends, human-in-the-loop, middleware/custom,
   skills, tools, permissions, structured-output).

Rank findings: CRITICAL (breaks correctness/legality/persistence contract),
SHOULD (token/architecture anti-pattern), NIT.

Specifically check the ten numbered rules in the SKILL. Do not flag stylistic
preferences; only flag deviations that change behavior, correctness, or the
spec's correctness rules (CR-1…CR-8).`,
  tools: [],
};
