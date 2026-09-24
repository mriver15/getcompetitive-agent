# getcompetitive-agent

A Pokémon Champions **DeepAgents** harness: the deterministic Dex query layer
(`resolve_entity` → `lookup_fact` → `search_dex`) plus the staged agent-created
set lifecycle (`stage_set` → `save_set`), with a Set Designer graph and a
benchmark-evidence model.

The doctrine, carried over unchanged from `getcompetitive`: **the model
explains; the deterministic engine calculates, validates, and proves.** No
number in an answer originates from model memory.

## What's here

- **Dex query** — `resolve_entity`, `lookup_fact`, `search_dex`, `expand_result`
  (typed constraint filters, reverse indexes, capability taxonomy, large-result
  paging via a content-hashed `resultRef`).
- **Set lifecycle** — `stage_set` (canonicalize + validate + hash → `ProposalRef`),
  `save_set` (persists only a validated `ProposalRef`, dedup by canonical hash),
  `search_saved_sets` (user-scoped Set Library).
- **Set Designer** — a LangGraph `StateGraph` (search → bounded design with a
  typed `SetDraft` → validation → repair loop → benchmark → `ProposalRef`),
  wrapped as a `CompiledSubAgent`.
- **Evidence** — `calculate_damage`, `calculate_speed`, `optimize_spread` emit
  content-addressed `EvidenceArtifact`s; `read_evidence` returns compact summaries.
- **Doctrine enforcement** — HITL approval on `save_set`, storage permissions
  denying the generic filesystem tools access to `/sets/`, and a `doctrine-guard`
  middleware.

## Quick start

```bash
npm install
npm run smoke     # builds + runs the deterministic end-to-end smoke path (no key/network)
npm run chat      # interactive multi-turn REPL; needs an LLM key (DEEPSEEK_API_KEY or CHAMPIONS_MODEL)
npm run demo      # one-shot: `npm run demo -- "…query…"`
```

The smoke path exercises the MVP gate: *"Build me a bulky Annihilape"* →
`SetDesignerGraph` → `ProposalRef` → `save_set` → `SetRef` → retrievable via
`search_saved_sets`, deduped on repeat, with lineage-preserved edits.

## Build the agent

```ts
import { buildChampionsAgent } from "getcompetitive-agent";

const agent = await buildChampionsAgent({
  // model: "deepseek:deepseek-chat",   // provider:model or a ChatModel instance
  autoSaveAgentProposals: false,        // save_set requires human approval
});

const config = {
  configurable: { thread_id: "my-thread", userId: "me" },
  context: { userId: "me" },
};
await agent.invoke({ messages: [{ role: "user", content: "Build me a bulky Annihilape for this team" }] }, config);
```

Model resolution (first match wins):

1. `model` option (`provider:model` or a chat-model instance);
2. `CHAMPIONS_MODEL` env var;
3. `deepseek:deepseek-chat` when `DEEPSEEK_API_KEY` is set (`@langchain/deepseek`);
4. `openai:gpt-5.5` otherwise.

So with `export DEEPSEEK_API_KEY=…` in your shell, `buildChampionsAgent()` just works on DeepSeek (`deepseek-chat`); pass `deepseek:deepseek-reasoner` explicitly for the reasoning model.

## Native client (web UI)

The agent is a compiled LangGraph, so any LangGraph client can drive it. The [Deep Agents UI](https://github.com/langchain-ai/deep-agents-ui) is a Next.js chat frontend built for exactly that:

```bash
# 1. Install the LangGraph CLI (Python tool)
uv tool install langgraph-cli      # or: pipx install langgraph-cli

# 2. Serve the agent (from this repo)
langgraph dev                      # API at http://127.0.0.1:2024, assistant id "agent"

# 3. Run the UI (separate clone)
git clone https://github.com/langchain-ai/deep-agents-ui.git
cd deep-agents-ui && yarn install && yarn dev   # http://localhost:3000
```

Open `http://localhost:3000`, enter Deployment URL `http://127.0.0.1:2024` and Assistant ID `agent`. The shell running `langgraph dev` must export `DEEPSEEK_API_KEY` (or `CHAMPIONS_MODEL`). See [`langgraph.json`](langgraph.json).


## Layout

```
src/core/dex/     deterministic data layer (@pkmn/dex + @smogon/calc), reverse indexes, resolver
src/core/set/     SetDraft model, stage validation, persistence helpers
src/core/evidence evidence model
src/tools/        LangChain tools (dex query, set lifecycle, benchmarks)
src/graph/        Set Designer StateGraph
src/middleware/   doctrine-guard
src/agent.ts      buildChampionsAgent
skills/           Agent Skills (build-set)
```

Conformance rules live in [`implementation-conformance.md`](implementation-conformance.md)
and the scope in [`mvp-plan.md`](mvp-plan.md). The data layer (Regulation
rosters, dex/calc wrappers) is ported from `getcompetitive`; see
`src/core/dex/regulations.ts` for the seasonal regulation sets.
