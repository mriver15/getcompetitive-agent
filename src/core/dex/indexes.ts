/**
 * Precomputed reverse indexes over the Champions dex + regulation rosters.
 *
 * Compound search is a deterministic set intersection in code, never a model
 * loop. Built once and memoized; every lookup below is O(1) / O(k).
 */
import type { Species } from "@pkmn/dex";
import { getDex, toID, learnableMoveIds, type GenerationNum } from "./dex.js";
import { REGULATION_SETS } from "./regulations.js";
import { buildCapabilityIndex, type CapabilityIndex } from "./capabilities.js";

export const DATASET_VERSION = "showdown-gen9@2026-09";
export const REGULATION_VERSION = REGULATION_SETS.map((s) => `${s.id}=${s.sourceAsOf}`).join(";");

function add(map: Map<string, Set<string>>, key: string, value: string): void {
  let set = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  set.add(value);
}

export interface DexIndexes {
  gen: GenerationNum;
  datasetVersion: string;
  regulationVersion: string;
  /** every species (incl. forms), keyed by canonical id */
  speciesById: Map<string, Species>;
  /** non-form species, keyed by canonical id */
  baseSpeciesById: Map<string, Species>;
  /** form id -> base species id */
  formToBase: Map<string, string>;
  /** type id -> species ids (base species only) */
  typesToSpecies: Map<string, Set<string>>;
  /** ability id -> species ids */
  abilitiesToSpecies: Map<string, Set<string>>;
  /** move id -> species ids that can learn it */
  movesToSpecies: Map<string, Set<string>>;
  /** capability tag -> species ids */
  capabilitiesToSpecies: Map<string, Set<string>>;
  /** regulation id -> legal base species ids */
  regulationToSpecies: Map<string, Set<string>>;
  /** base species id -> learnable move ids */
  speciesToMoves: Map<string, Set<string>>;
  /** species id -> ability ids */
  speciesToAbilities: Map<string, Set<string>>;
  capabilityIndex: Map<string, CapabilityIndex>;
}

let cached: DexIndexes | undefined;

export async function getDexIndexes(gen: GenerationNum = 9): Promise<DexIndexes> {
  if (cached && cached.gen === gen) return cached;

  const dex = getDex(gen);
  const all = dex.species.all();

  const speciesById = new Map<string, Species>();
  const baseSpeciesById = new Map<string, Species>();
  const formToBase = new Map<string, string>();
  const typesToSpecies = new Map<string, Set<string>>();
  const abilitiesToSpecies = new Map<string, Set<string>>();
  const speciesToAbilities = new Map<string, Set<string>>();

  for (const s of all) {
    speciesById.set(s.id, s);
    const abilities = Object.values(s.abilities ?? {}).filter((a) => a && a !== "No Ability");
    speciesToAbilities.set(s.id, new Set(abilities.map(toID)));
    if (!s.forme && !s.isMega && !s.battleOnly) {
      baseSpeciesById.set(s.id, s);
      for (const t of s.types) add(typesToSpecies, toID(t), s.id);
      for (const a of abilities) add(abilitiesToSpecies, toID(a), s.id);
    } else {
      const baseId = toID(s.baseSpecies || s.name);
      if (baseId !== s.id) formToBase.set(s.id, baseId);
    }
  }

  // Learnset-derived reverse index. Learnable move ids already collapse the
  // evolution line + base species (see dex.ts), so attribute each move to the
  // base species and all its forms.
  const movesToSpecies = new Map<string, Set<string>>();
  const speciesToMoves = new Map<string, Set<string>>();
  for (const base of baseSpeciesById.values()) {
    const moveIds = await learnableMoveIds(dex, base);
    const targets: string[] = [base.id];
    for (const [formId, baseId] of formToBase) if (baseId === base.id) targets.push(formId);
    for (const target of targets) {
      speciesToMoves.set(target, moveIds);
      for (const mid of moveIds) add(movesToSpecies, mid, target);
    }
  }

  // Regulation legality (base species; Species Clause is by National Dex number).
  const regulationToSpecies = new Map<string, Set<string>>();
  for (const set of REGULATION_SETS) {
    regulationToSpecies.set(set.id, new Set(set.eligibleSpecies.map(toID)));
  }

  // Capability -> species (union of tagged-ability holders and tagged-move learners).
  const capabilityIndex = buildCapabilityIndex();
  const capabilitiesToSpecies = new Map<string, Set<string>>();
  for (const [tag, cap] of capabilityIndex) {
    const holders = new Set<string>();
    for (const abilityId of cap.abilityIds) {
      const species = abilitiesToSpecies.get(abilityId);
      if (species) for (const id of species) holders.add(id);
    }
    for (const moveId of cap.moveIds) {
      const species = movesToSpecies.get(moveId);
      if (species) for (const id of species) holders.add(id);
    }
    capabilitiesToSpecies.set(tag, holders);
  }

  cached = {
    gen,
    datasetVersion: DATASET_VERSION,
    regulationVersion: REGULATION_VERSION,
    speciesById,
    baseSpeciesById,
    formToBase,
    typesToSpecies,
    abilitiesToSpecies,
    movesToSpecies,
    capabilitiesToSpecies,
    regulationToSpecies,
    speciesToMoves,
    speciesToAbilities,
    capabilityIndex,
  };
  return cached;
}

/** Compound search: intersect a set of species id sets (empty query -> all base species). */
export function intersectSpecies(
  indexes: DexIndexes,
  sets: Array<Set<string> | undefined>,
): Set<string> {
  const universe = new Set(indexes.baseSpeciesById.keys());
  const defined = sets.filter((s): s is Set<string> => s !== undefined);
  if (defined.length === 0) return universe;
  const first = defined[0];
  const out = new Set<string>();
  for (const id of first) {
    if (defined.every((s) => s.has(id))) out.add(id);
  }
  return out;
}
