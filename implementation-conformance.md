# LangChain / DeepAgents / LangGraph — Implementation Conformance

Grounded in the current Docs by LangChain (JS), fetched 2026-09-23. This is the authoritative mapping from the spec's MVP plan to the actual current APIs. Where the MVP plan is silent or wrong against the docs, the correction is called out.

Primary docs (URLs; paths under the docs site):
- Deep Agents overview — https://docs.langchain.com/oss/javascript/deepagents/overview
- Customization / `createDeepAgent` params — https://docs.langchain.com/oss/javascript/deepagents/customization
- Subagents (sync) — https://docs.langchain.com/oss/javascript/deepagents/subagents
- Async subagents — https://docs.langchain.com/oss/javascript/deepagents/async-subagents
- Skills — https://docs.langchain.com/oss/javascript/deepagents/skills
- Tools — https://docs.langchain.com/oss/javascript/deepagents/tools
- Backends — https://docs.langchain.com/oss/javascript/deepagents/backends
- Memory — https://docs.langchain.com/oss/javascript/deepagents/memory
- Human-in-the-loop — https://docs.langchain.com/oss/javascript/deepagents/human-in-the-loop
- Context engineering — https://docs.langchain.com/oss/javascript/deepagents/context-engineering
- Custom middleware — https://docs.langchain.com/oss/javascript/langchain/middleware/custom
- Permissions — https://docs.langchain.com/oss/javascript/deepagents/permissions
- Structured output — https://docs.langchain.com/oss/javascript/langchain/structured-output
- Harness profiles — https://docs.langchain.com/oss/javascript/deepagents/profiles
- MCP — https://docs.langchain.com/oss/javascript/langchain/mcp

## 0. Framework facts that shape the whole build

- `deepagents` is a harness on top of LangChain agents + LangGraph. The supervisor is one `createDeepAgent(...)`; every spec graph/subagent is either a `SubAgent`/`CompiledSubAgent` or a compiled LangGraph `StateGraph`.
- The spec's "no MCP runtime dependency" is already how the SDK works: MCP is an **optional** adapter (`@langchain/mcp-adapters`), not a boundary. Native `tool()`s are first-class. `src/adapters/mcp/` is therefore a thin compatibility shim only.
- Every agent-side tool in the spec (`lookup_fact`, `search_dex`, `stage_set`, `save_set`, …) is a LangChain `tool(fn, { name, description, schema })` with a Zod schema. Deterministic logic (`getcompetitive-core`) is plain TypeScript **inside** those tool bodies — never LLM work.

## 1. Dex Query (MVP Phase 1) — L-1…L-10

- `resolve_entity`, `lookup_fact`, `search_dex`, `expand_result` = `tool()`s. The resolver/reverse-index/intersection logic is plain TS in `core/dex/`.
- **Projection (L-4)** is enforced in the tool implementation: return only requested `fields` + identity. Do not round-trip full records and ask the model to trim.
- **Large results (L-8 / CR-7):** do NOT rely on the harness's implicit offloading (auto-fires at ~20k result tokens and replaces output with a 10-line preview). Implement explicit `{ total, preview, resultRef }`, write the full result to `StateBackend` (thread-scoped), and have `expand_result` page it back. Keep the default preview small by construction.
- Reverse indexes (move/ability/type/capability/regulation → species) are a precomputed in-memory table, not a model loop. Compound search = set intersection in code.

## 2. Set artifact foundation (MVP Phase 2) — S-1…S-6

- `SetDraft` = a Zod schema. Have the designer emit a **typed draft**: set `responseFormat` (Zod/JSON schema) on the Set Designer subagent so the model returns structured `SetDraft`, not prose.
- `stage_set` = a `tool()` whose body runs the canonicalization → learnset/ability/item/EV-CP/regulation validation → hash pipeline. Emits `StageSetResult` with `legal`, `warnings`, `errors`, `setHash`, and a `ProposalRef`.
- **Staging ephemeral (§17):** write the proposal artifact to `StateBackend` (thread-scoped). This is exactly the docs' "files persist across turns within a thread, not shared across threads." `ProposalRef` = the state key. Staging requires no approval (correct — do not put `stage_set` in `interruptOn`).

## 3. Set persistence (MVP Phase 3) — S-7…S-12

- `save_set` = a `tool()` that resolves `sourceRef`, canonicalizes into a `SavedSet`, and writes it to a **`StoreBackend`** (cross-thread durable) with a **user-scoped namespace factory** `(rt) => [rt.serverInfo.user.identity]`. This is the "Set Library" (§28). Add an `assistantId` segment for per-agent isolation.
- **Approval (S-8 / §24 / §40):** use built-in HITL, not hand-rolled control flow:

  ```ts
  createDeepAgent({
    interruptOn: { save_set: { allowedDecisions: ["approve", "reject"] } },
    checkpointer,          // REQUIRED — HITL does not work without a checkpointer
  })
  ```

  Resume with `new Command({ resume: { decisions } })` using the same `thread_id` config. `stage_set` stays non-interrupting.

- **CR-8 enforcement (only `save_set` persists, never the model):** a tool allowlist is **not sufficient**. Two reasons, both doc-grounded:
  1. The auto `general-purpose` subagent "has the same instructions as the main agent and all the tools it has access to" — so if the supervisor has `write_file`, so does `general-purpose`.
  2. Subagent `tools` **replaces** inherited tools entirely (not a merge) — good for restriction, but the parent still holds the full set.

  Enforce at the storage layer: route `/sets/` to a `StoreBackend` via `CompositeBackend` and set `permissions` (declarative, first-match-wins) to deny agent writes to that path, so the generic `write_file`/`edit_file` tools cannot touch the library. Add a `doctrine-guard` middleware (below) as a second line.
- **Dedup (S-9):** content-hash (`setHash`) is the store key; duplicate `save_set` returns the existing `SetRef` (no-op).
- **Lineage (S-10):** `parentSetRef` field on `SavedSet`; `parentRef` on `ProposalArtifact`.
- **`search_saved_sets` (S-12):** `tool()` reading the `/sets/` store, independent of the `/meta/` namespace.
- **Knowledge-space separation (§14):** use distinct `StoreBackend` namespaces — `["dex"]`, `["meta"]`, `["sets"]` — never one merged store.

## 4. Set Designer graph (MVP Phase 4)

- Build as a LangGraph `StateGraph` with nodes: `search_dex` (deterministic) → `model` (bounded design, `responseFormat`) → `stage_set` → conditional repair edge → `benchmark` → `end`. Wrap: `CompiledSubAgent { name: "set-designer", description, runnable: graph.compile() }`. The supervisor invokes it via `task`.
- **Tool allowlist (§18):** set `tools: [lookupFact, searchDex, calculateDamage, calculateSpeed, optimizeSpread, stageSet, readEvidence]` on the subagent. Because `tools` fully replaces inheritance, this is how `save_set` and generic filesystem writes stay out of the designer. Keep the list minimal — it is token cost (§34-35).
- **Skills isolation:** custom subagents do **not** inherit parent skills. Pass `skills: [...]` explicitly or omit. Do not assume the designer sees the supervisor's skills.
- One benchmark type end-to-end: `calculate_damage` or `calculate_speed` writes an `EvidenceArtifact { provenance: "ENGINE"|"DEX"|…, inputHash, artifactHash, result }` to state and returns `EvidenceRef`; `read_evidence` returns a compact summary, not the full `result`.

## 5. State, middleware, skills (cross-cutting)

- **`ChampionsState` (§31):** custom state fields via `StateSchema` (in `createAgent`) or middleware `stateSchema`. Store **references only**. Prefix non-output fields with `_` (private — excluded from the result). Async tasks already have a dedicated `asyncTasks` channel if you use async subagents.
- **`doctrine-guard` middleware (§19 / CR rules):** `createMiddleware({ wrapToolCall })` — inspect tool + args + result; block (a) presenting a PROPOSAL as META/measured, (b) `save_set` whose `sourceRef` is not a validated ProposalRef/InferenceRef, (c) any stated damage/speed claim without an evidence ref. Return a `Command` or reject the call.
- **`persistence-approval` (§24/§40):** implement as the built-in `interruptOn`, plus a thin middleware only for the `autoSaveAgentProposals` policy flag. Default `false`.
- **Skills (§37):** each = a directory with `SKILL.md` (frontmatter `name` + `description`, body ≤5k tokens / ≤500 lines). `createDeepAgent({ skills: ["/skills/"] })`. Write specific descriptions (activation keywords) and keep frontmatter concise — it's injected into the system prompt at startup for every skill. Distinct overlapping skills degrade selection; consolidate.
- **Token economy (§34-35):** shrink baseline prompt by dropping unused built-in tools via a harness profile `excluded_tools` (e.g. `write_file`, `execute`, `edit_file`) on read-only/reasoning agents. Write tight tool descriptions (include *when* to use + per-arg `describe`).

## 6. Version pins & non-negotiables

- Skills require `deepagents >= 1.7.0`.
- `StoreBackend.namespace` becomes **required** in `1.9.0` — always pass a namespace factory.
- HITL (`interruptOn`) requires a `checkpointer`.
- Do not remove `SubAgentMiddleware`/`FilesystemMiddleware` via `excluded_middleware` — it is rejected by design. Use `excluded_tools` or harness-profile knobs instead.

## Corrections to the MVP plan (summary)

1. **CR-8 cannot be enforced by allowlists alone** (general-purpose subagent inherits all parent tools; subagent `tools` is replace-not-merge). Add storage-layer `permissions` + `doctrine-guard` middleware. → amend plan item 18 and the MVP gate.
2. **Approval is built-in HITL**, not a custom graph node. Use `interruptOn` + `checkpointer` + `Command(resume)`.
3. **Set Library = `StoreBackend` (user-namespaced), staging = `StateBackend` (thread-scoped).** This is the cleanest realization of §17 vs §28; the plan's "artifact store" item 10 should name these two backends explicitly.
4. **Large-result preview must be explicit**, not the harness's implicit 20k-token offloading.
5. **Structured output** (`responseFormat` Zod schema) for `SetDraft` — otherwise the model emits free text and `stage_set` reparses it (correctness risk).
6. **Skills do not auto-inherit to custom subagents** — relevant to `build-around`/`team-doctor` guidance when those become subagents.
