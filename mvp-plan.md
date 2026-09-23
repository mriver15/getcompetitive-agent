# MVP List — Dex Query & Set Lifecycle

**Source spec:** `champions-deepagent-dex-set-lifecycle-spec-v0.4.md`

**MVP definition:** deterministic Dex query (resolve → lookup → search) plus the staged agent-created set lifecycle (`stage_set` → `save_set`), on a real data layer, with the direct "build → stage → save" path working end-to-end. Vector search, multi-graph workflow integration, and optimization are deferred.

The spec assumes `getcompetitive-core` exists beneath the agent. That data layer is a hard prerequisite, not MVP scope itself.

---

## Prerequisite (blocking, not counted as MVP scope)

- **P0 — `getcompetitive-core` Dex data** exists and is reachable: species, forms, moves, items, abilities, natures, learnsets, and Regulation Set legality tables, each stamped with a `datasetVersion` / `regulationVersion`. If it lives in a separate repo, wire it as a dependency before Phase 1.

---

## Phase 1 — Dex Query foundation (MVP)

1. `resolve_entity` — canonical ID → exact normalized name → alias → base/form map → fuzzy candidates. Returns `ResolutionResult` with `status` and, on `ambiguous`/`fuzzy`, candidates only (no silent pick). → **L-1, L-2, L-3, L-6** (CR-6)
2. `lookup_fact` — atomic retrieval with required `fields` projection; `names` batch support; `regulation` filter. Returns only requested fields + identity metadata. → **L-4, L-5**
3. `search_dex` — typed constraint filters (types, learns, abilities, capabilities, min/max stats, resists/immunities, legalOnly) with `sort`/`limit`/`offset`. → **L-6, L-7, L-9**
4. Reverse indexes — move→species, ability→species, type→species, capability→species, regulation→legal species, form↔base, species→moves/abilities. Compound search = deterministic set intersection. → **L-6, L-7**
5. Capability taxonomy — engine-defined move/ability tags (`speed_control`, `pivot`, `intimidate`, …) wired into search filters. → **L-10**
6. `SearchResultRef` + `expand_result` — large results stored as immutable, content-hashed artifacts; small preview returned, paged expansion on demand. → **L-8** (CR-7)

---

## Phase 2 — Set artifact foundation (MVP)

7. `SetDraft` model — `species`, `item`, `ability`, `nature`, `moves`, `evs`/`championsPoints`, `role`, `intendedAnswers`, `intendedPartners`, `rationale`. → **S-1**
8. `stage_set` validation pipeline — canonicalize species/form/item/ability/nature/moves; verify learnset, ability, item/form constraints, EV/CP exclusivity, allocation limits, regulation; compute canonical hash. Emits `ProposalRef` + `warnings`/`errors` + `legal`. → **S-2, S-3, S-4**
9. `ProposalArtifact` — `canonicalSet`, `basis: "proposed"`, `origin.type: "agent"`, `rationale`, `evidenceRefs`, `parentRef`, `validation`, `hash`, `createdAt`. No hidden CoT. → **S-6, S-5** (CR-4)
10. Artifact store — immutable, opaque-stable refs for `SearchResultRef`/`EvidenceRef`/`ProposalRef`/`InferenceRef`/`SetRef`; content-hash where appropriate. → **S-6**

---

## Phase 3 — Set persistence (MVP)

11. `save_set` — persists by `sourceRef` (ProposalRef/InferenceRef), never model-re-emitted JSON. Resolves artifact in the store. → **S-7** (CR-8)
12. Approval gate — staging free; saving approval-gated by default (`autoSaveAgentProposals = false`); explicit "build and save" bypasses. → **S-8**
13. `SetRef` + Set Library — user-scoped persistent store, separate from measured meta; `SavedSet` record with `basis`/`origin`/`parentSetRef`/`tags`. → **S-11** (CR-5)
14. Deduplication — canonical content hash (species/form, item, ability, nature, moves, IVs, EVs/CP, level); duplicate save returns existing `SetRef` / no-op. → **S-9**
15. Lineage — `parentSetRef` / `parentRef` on saved sets and proposals. → **S-10**
16. `search_saved_sets` — query by species, regulation, basis, origin, tags, intendedAnswers, workflow; independent of meta. → **S-12**

---

## Phase 4 — Set Designer graph (MVP core)

17. `SetDesignerGraph` — goal/species → `search_dex` candidates → bounded LLM design → `SetDraft` → `stage_set` → bounded repair loop on validation failure → targeted benchmark(s) → `ProposalRef`. → **S-1…S-5**
18. Tool allowlist for the designer — `lookup_fact`, `search_dex`, `calculate_damage`, `calculate_speed`, `optimize_spread`, `stage_set`, `read_evidence`. Explicitly **not** `save_set` / generic FS write.
19. Evidence model — `EvidenceArtifact` with `provenance` (`DEX`/`META`/`ENGINE`/`INFERENCE`) + `read_evidence` compact-summary path; benchmarks emit `EvidenceRef`s. → **S-5** (CR-3)
20. One benchmark type wired end-to-end (speed or survival), enough to satisfy CR-3 without exhaustive coverage. Remaining benchmark types post-MVP.

---

## Explicitly out of MVP (defer)

- **Phase 5** workflow integration — TeamDoctorGraph / BuildAroundGraph / MatchupGraph / ScoutAgent wiring (only the direct build→save path is MVP).
- **Phase 6** optimization/tuning (schema size, turn counts, cache hit rate).
- Vector/embedding search (semantic search) — non-goal per §47.
- `revalidate_set` — defer to post-MVP unless regulation-change handling is required day one.
- Cache strategy (§41) — defer; optional trivial canonical-hash memoization if free.

---

## MVP gate (definition of done)

- **L-1…L-10** and **S-1…S-12** all pass, with the exception that **S-8** requires approval and **S-5** requires ≥1 benchmark type working.
- One smoke path: *"Build me a bulky Annihilape for this team"* → `SetDesignerGraph` → `ProposalRef` → presented with evidence → user accepts → `save_set(sourceRef)` → `SetRef` → retrievable via `search_saved_sets`, deduped on repeat, lineage-preserved on edit.
