/**
 * stage_set validation pipeline (spec §17) — canonicalize species/form/item/
 * ability/nature/moves, verify learnset + ability + spread + regulation, and
 * compute the canonical hash. Deterministic; no model reasoning.
 */
import type { GenerationNum } from "../dex/dex.js";
import { getDex, toID, learnableMoveIds, resolveEvs } from "../dex/dex.js";
import { getRegulationSet } from "../dex/regulations.js";
import { resolveEntity } from "../dex/resolver.js";
import {
  canonicalHash,
  type CanonicalSet,
  type EvidenceRef,
  type ProposalRef,
  type RegulationId,
  type SetDraft,
  type SetRef,
  type SetSummary,
  type StageSetResult,
} from "./model.js";
import { proposalRef } from "./store.js";

const CHAMPIONS_LEVEL = 50;

export interface StageOptions {
  gen?: GenerationNum;
  /** Default regulation when the draft omits one. */
  regulation?: RegulationId;
  goal?: string;
  evidenceRefs?: EvidenceRef[];
  parentSetRef?: SetRef | ProposalRef;
}

/** Full pipeline outcome: the model-facing result plus the full canonical set for the artifact. */
export interface StageOutcome {
  result: StageSetResult;
  canonicalSet: CanonicalSet;
}

function summary(canonicalSet: CanonicalSet): SetSummary {
  return {
    species: canonicalSet.species,
    forme: canonicalSet.forme,
    item: canonicalSet.item,
    ability: canonicalSet.ability,
    nature: canonicalSet.nature,
    moves: [...canonicalSet.moves],
    evs: canonicalSet.evs ? { ...canonicalSet.evs } : undefined,
  };
}

export async function stageSet(draft: SetDraft, opts: StageOptions = {}): Promise<StageOutcome> {
  const gen = opts.gen ?? 9;
  const dex = getDex(gen);
  const warnings: string[] = [];
  const errors: string[] = [];
  const regulationId: RegulationId = (draft.regulation ?? opts.regulation ?? "m-c").toLowerCase().replace(/[^a-z0-9]/g, "");

  const unresolved: StageOutcome = {
    result: { ok: false, legal: false, warnings, errors, evidenceRefs: opts.evidenceRefs ?? [] },
    canonicalSet: { species: draft.species, moves: [], level: CHAMPIONS_LEVEL },
  };

  // 1. Canonicalize species (and form).
  const res = resolveEntity(draft.species, { gen });
  if (!res.canonicalId || !res.canonicalName) {
    unresolved.result.errors = [`Unresolved species "${draft.species}" (${res.status}).`];
    return unresolved;
  }
  const sp = dex.species.get(res.canonicalName);
  const baseSpecies = sp.baseSpecies && sp.baseSpecies !== sp.name ? sp.baseSpecies : sp.name;
  const forme = sp.forme || undefined;

  // 2. Canonicalize item.
  let item: string | undefined;
  if (draft.item) {
    const it = dex.items.get(draft.item);
    if (!it.exists) errors.push(`Unknown item "${draft.item}".`);
    else item = it.name;
  }

  // 3. Canonicalize ability + verify it is legal on the species.
  let ability: string | undefined;
  if (draft.ability) {
    const ab = dex.abilities.get(draft.ability);
    if (!ab.exists) errors.push(`Unknown ability "${draft.ability}".`);
    else {
      ability = ab.name;
      const legal = Object.values(sp.abilities ?? {}).filter((a) => a && a !== "No Ability");
      if (!legal.includes(ab.name)) {
        errors.push(`Ability "${ab.name}" is not available on ${sp.name}.`);
      }
    }
  }

  // 4. Canonicalize nature.
  let nature: string | undefined;
  if (draft.nature) {
    const n = dex.natures.get(draft.nature);
    if (!n.exists) errors.push(`Unknown nature "${draft.nature}".`);
    else nature = n.name;
  }

  // 5. Canonicalize moves + verify learnset.
  const moves: string[] = [];
  for (const raw of draft.moves ?? []) {
    const m = dex.moves.get(raw);
    if (!m.exists) {
      errors.push(`Unknown move "${raw}".`);
      continue;
    }
    moves.push(m.name);
  }
  if (moves.length > 0) {
    const learnable = await learnableMoveIds(dex, sp);
    for (const name of moves) {
      if (!learnable.has(toID(name))) {
        errors.push(`Move "${name}" is not in ${sp.name}'s learnset.`);
      }
    }
  }

  // 6. Spread: EV/CP exclusivity + allocation limits.
  let evs: Record<string, number> | undefined;
  try {
    const resolved = resolveEvs(draft.evs, draft.championsPoints);
    if (Object.keys(resolved).length > 0) evs = resolved;
  } catch (e) {
    errors.push((e as Error).message);
  }

  // 7. Regulation roster legality (Species Clause is by National Dex number).
  const regSet = getRegulationSet(regulationId);
  if (!regSet) {
    warnings.push(`Unknown regulation "${regulationId}"; roster legality skipped.`);
  } else if (!regSet.eligibleSpecies.map(toID).includes(toID(baseSpecies))) {
    errors.push(`Species "${baseSpecies}" is not legal in Regulation Set ${regSet.id}.`);
  }

  const canonicalSet: CanonicalSet = {
    species: baseSpecies,
    forme,
    item,
    ability,
    nature,
    moves,
    evs,
    level: CHAMPIONS_LEVEL,
  };

  const ok = errors.length === 0;
  const setHash = ok ? canonicalHash(canonicalSet) : undefined;

  return {
    result: {
      ok,
      legal: ok,
      warnings,
      errors,
      setHash,
      canonicalSet: ok ? summary(canonicalSet) : undefined,
      proposalRef: ok ? proposalRef(setHash as string) : undefined,
      evidenceRefs: opts.evidenceRefs ?? [],
    },
    canonicalSet,
  };
}
