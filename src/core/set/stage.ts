/**
 * stage_set validation pipeline — canonicalize species/form/item/ability/nature/
 * moves, verify learnset + ability + spread + regulation, compute the canonical
 * hash. Deterministic; no model reasoning. Emits warnings/errors + legal.
 */
import type { GenerationNum } from "../dex/dex.js";
import { getDex, toID, learnableMoveIds, resolveEvs } from "../dex/dex.js";
import { getRegulationSet } from "../dex/regulations.js";
import { resolveEntity } from "../dex/resolver.js";
import { canonicalHash, type CanonicalSet, type SetDraft, type StageSetResult } from "./model.js";

const CHAMPIONS_LEVEL = 50;

export interface StageOptions {
  gen?: GenerationNum;
  /** Default regulation when the draft omits one. */
  regulation?: string;
}

export async function stageSet(draft: SetDraft, opts: StageOptions = {}): Promise<StageSetResult> {
  const gen = opts.gen ?? 9;
  const dex = getDex(gen);
  const warnings: string[] = [];
  const errors: string[] = [];

  // 1. Canonicalize species (and form).
  const res = resolveEntity(draft.species, gen);
  if (res.status !== "resolved" || !res.resolved) {
    return {
      legal: false,
      warnings,
      errors: [`Unresolved species "${draft.species}" (${res.status}).`],
      setHash: "",
      canonicalSet: emptyCanonical(draft.species),
      regulation: draft.regulation ?? opts.regulation ?? "m-c",
    };
  }
  const sp = dex.species.get(res.resolved.id);
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
  if (draft.moves?.length) {
    const learnable = await learnableMoveIds(dex, sp);
    for (const raw of draft.moves) {
      const m = dex.moves.get(raw);
      if (!m.exists) {
        errors.push(`Unknown move "${raw}".`);
        continue;
      }
      moves.push(m.name);
      if (!learnable.has(toID(m.name))) {
        errors.push(`Move "${m.name}" is not in ${sp.name}'s learnset.`);
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
  const regulation = (draft.regulation ?? opts.regulation ?? "m-c").toLowerCase().replace(/[^a-z0-9]/g, "");
  const regSet = getRegulationSet(regulation);
  if (!regSet) {
    warnings.push(`Unknown regulation "${regulation}"; roster legality skipped.`);
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

  return {
    legal: errors.length === 0,
    warnings,
    errors,
    setHash: errors.length === 0 ? canonicalHash(canonicalSet) : "",
    canonicalSet,
    regulation: regSet?.id ?? regulation,
  };
}

function emptyCanonical(species: string): CanonicalSet {
  return { species, moves: [], level: CHAMPIONS_LEVEL };
}
