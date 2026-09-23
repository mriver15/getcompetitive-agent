---
name: build-set
description: >-
  Build a single competitive Pokémon Champions set from a goal and a species
  (or a team slot). Use when the user says "build me a ...", "make a set for
  ...", "design a ...", or asks for a spread/moves/item for a named Pokémon.
  Chain: resolve_entity -> search_dex -> set-designer -> stage_set -> present
  -> save_set (on approval).
---

# Build a set

## Workflow

1. `resolve_entity` on the target species (or the slot's species). If the name
   is a form, alias, or typo, use the returned candidates; never silently pick.
2. `search_dex` for candidates and constraints: type coverage, answer-threats,
   capability tags (speed_control, pivot, intimidate, ...), and regulation
   legality (`legalOnly` or `regulation`). Page large results with
   `expand_result`.
3. Delegate the actual design to the `set-designer` subagent with the goal and
   the resolved species. It searches candidates, drafts a typed set, validates
   it, benchmarks it, and returns a `ProposalRef` plus evidence.
4. Present the proposal to the user with its benchmark evidence (from
   `read_evidence` on the returned evidence refs) before saving.
5. On the user's approval, `save_set` with the exact `ProposalRef`. Do not
   re-emit the set as JSON — `save_set` only persists a staged ref.

## Rules

- The engine validates and proves; you narrate. Never state a number the tools
  did not return.
- Staging (`stage_set`) is free and thread-scoped; saving requires approval.
- Report the `regulation` and dataset version alongside any claim.
