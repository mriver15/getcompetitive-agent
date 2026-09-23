/**
 * Dex query tools (MVP Phase 1): resolve_entity, lookup_fact, search_dex,
 * expand_result. Deterministic logic only; the model routes, these prove.
 */
import { tool } from "langchain";
import { z } from "zod";
import type { Species } from "@pkmn/dex";
import {
  getDex,
  speciesToObj,
  toID,
  typeEffectiveness,
  learnableMoveIds,
} from "../core/dex/dex.js";
import {
  getDexIndexes,
  intersectSpecies,
  DATASET_VERSION,
} from "../core/dex/indexes.js";
import { resolveEntity } from "../core/dex/resolver.js";
import { getRegulationSet } from "../core/dex/regulations.js";
import { sha256 } from "../core/set/model.js";
import { SEARCH_NS } from "../core/set/store.js";
import { getThreadId, getStore } from "./runtime.js";

const GEN = 9;

export const resolveEntityTool = tool(
  async ({ query }: { query: string }) => JSON.stringify(resolveEntity(query, GEN)),
  {
    name: "resolve_entity",
    description:
      "Resolve a Pokémon Champions entity name to its canonical form. Runs canonical id -> exact name -> alias -> base/form map -> fuzzy candidates. Use before lookup_fact or search_dex when a name may be a form, alias, or typo.",
    schema: z.object({
      query: z.string().describe("The species or form name to resolve."),
    }),
  },
);

const LOOKUP_FIELDS = z.array(
  z.enum(["types", "baseStats", "bst", "abilities", "num", "moves", "learnset", "forme", "legalIn"]),
);

export const lookupFactTool = tool(
  async ({
    entity,
    names,
    fields,
    regulation,
  }: {
    entity?: string;
    names?: string[];
    fields: Array<"types" | "baseStats" | "bst" | "abilities" | "num" | "moves" | "learnset" | "forme" | "legalIn">;
    regulation?: string;
  }) => {
    const targets = names && names.length > 0 ? names : entity ? [entity] : [];
    const dex = getDex(GEN);
    const wanted = new Set(fields.length > 0 ? fields : ["types", "baseStats"]);
    const results: Array<Record<string, unknown>> = [];

    for (const name of targets) {
      const res = resolveEntity(name, GEN);
      if (res.status !== "resolved" || !res.resolved) {
        results.push({ name, status: res.status, candidates: res.candidates ?? [] });
        continue;
      }
      const sp = dex.species.get(res.resolved.id);
      const projected = await projectSpecies(sp, wanted);
      if (regulation) {
        projected.legalIn = isLegalIn(sp, regulation);
      }
      results.push(projected);
    }

    return JSON.stringify({ datasetVersion: DATASET_VERSION, results });
  },
  {
    name: "lookup_fact",
    description:
      "Atomic dex lookup with a required fields projection. Returns only the requested fields plus identity (id/name). Use for one fact at a time (a species' stats, its abilities, its learnset). Batch with `names`.",
    schema: z.object({
      entity: z.string().optional().describe("A single species name."),
      names: z.array(z.string()).optional().describe("Batch of species names."),
      fields: LOOKUP_FIELDS.describe("Fields to project; only these plus identity are returned."),
      regulation: z.string().optional().describe("Regulation id to also report legalIn."),
    }),
  },
);

async function projectSpecies(sp: Species, wanted: Set<string>): Promise<Record<string, unknown>> {
  const obj = speciesToObj(sp);
  const out: Record<string, unknown> = { id: sp.id, name: sp.name };
  if (wanted.has("types")) out.types = obj.types;
  if (wanted.has("baseStats")) out.baseStats = obj.baseStats;
  if (wanted.has("bst")) out.bst = obj.bst;
  if (wanted.has("abilities")) out.abilities = obj.abilities;
  if (wanted.has("num")) out.num = obj.num;
  if (wanted.has("forme")) out.forme = obj.forme;
  if (wanted.has("moves")) {
    const learnable = await learnableMoveIds(getDex(GEN), sp);
    out.moves = [...learnable].map((id) => getDex(GEN).moves.get(id).name).sort();
  }
  return out;
}

function isLegalIn(sp: Species, regulation: string): boolean {
  const set = getRegulationSet(regulation.toLowerCase().replace(/[^a-z0-9]/g, ""));
  if (!set) return false;
  const base = sp.baseSpecies && sp.baseSpecies !== sp.name ? sp.baseSpecies : sp.name;
  return set.eligibleSpecies.map(toID).includes(toID(base));
}

export const searchDexTool = tool(
  async (args: SearchDexArgs, runtime) => {
    const indexes = await getDexIndexes(GEN);
    const dex = getDex(GEN);

    // Start from the universe (all base species), or the legal roster.
    let universe = new Set(indexes.baseSpeciesById.keys());
    if (args.regulation) {
      const roster = indexes.regulationToSpecies.get(args.regulation.toLowerCase().replace(/[^a-z0-9]/g, ""));
      if (roster) universe = new Set(roster);
    } else if (args.legalOnly) {
      const current = getRegulationSet("m-c");
      if (current) universe = new Set(current.eligibleSpecies.map(toID));
    }

    const constraintSets: Array<Set<string> | undefined> = [];

    // Type constraint: species must carry every listed type.
    if (args.types?.length) {
      const typeSets = args.types.map((t) => indexes.typesToSpecies.get(toID(t)));
      if (typeSets.some((s) => !s)) {
        return JSON.stringify({ total: 0, preview: [], note: `Unknown type in ${args.types.join(", ")}.` });
      }
      for (const s of typeSets) constraintSets.push(s);
    }

    // Learnset constraint: must learn every listed move.
    if (args.learns?.length) {
      const moveSets = args.learns.map((m) => indexes.movesToSpecies.get(toID(m)));
      if (moveSets.some((s) => !s)) {
        return JSON.stringify({ total: 0, preview: [], note: `Unknown move in ${args.learns.join(", ")}.` });
      }
      for (const s of moveSets) constraintSets.push(s);
    }

    // Ability constraint: must have one of the listed abilities.
    if (args.abilities?.length) {
      const union = new Set<string>();
      for (const a of args.abilities) {
        const s = indexes.abilitiesToSpecies.get(toID(a));
        if (s) for (const id of s) union.add(id);
      }
      constraintSets.push(union);
    }

    // Capability constraint: must hold every listed capability.
    if (args.capabilities?.length) {
      for (const cap of args.capabilities) {
        const s = indexes.capabilitiesToSpecies.get(cap);
        if (!s) {
          return JSON.stringify({ total: 0, preview: [], note: `Unknown capability "${cap}".` });
        }
        constraintSets.push(s);
      }
    }

    // Restrict constraints to the universe, then intersect.
    constraintSets.push(universe);
    const hits = intersectSpecies(indexes, constraintSets);

    // Stat bounds.
    const rows: Array<{ id: string; name: string; num: number; types: string[]; baseStats: Record<string, number>; bst: number }> = [];
    for (const id of hits) {
      const sp = indexes.speciesById.get(id);
      if (!sp) continue;
      if (args.minStats && !meetsBounds(sp, args.minStats, "min")) continue;
      if (args.maxStats && !meetsBounds(sp, args.maxStats, "max")) continue;
      if (args.resists?.length && !args.resists.every((t) => typeEffectiveness(t, sp.types, GEN) < 1)) continue;
      if (args.immunities?.length && !args.immunities.every((t) => typeEffectiveness(t, sp.types, GEN) === 0)) continue;
      rows.push({
        id: sp.id,
        name: sp.name,
        num: sp.num,
        types: [...sp.types],
        baseStats: { ...sp.baseStats },
        bst: sp.bst,
      });
    }

    rows.sort(comparator(args.sort ?? "num"));

    const total = rows.length;
    const limit = args.limit ?? 20;
    const offset = args.offset ?? 0;
    const page = rows.slice(offset, offset + limit);

    // Large results: store the full result thread-scoped and hand back a ref.
    const store = getStore(runtime);
    if (total > limit && store) {
      const key = sha256(JSON.stringify(args));
      await store.put([SEARCH_NS, getThreadId(runtime)], key, {
        total,
        args,
        rows: rows.map((r) => JSON.parse(JSON.stringify(r))),
      });
      return JSON.stringify({ total, resultRef: `search:${key}`, preview: page });
    }

    return JSON.stringify({ total, preview: page });
  },
  {
    name: "search_dex",
    description:
      "Typed constraint search over the Champions dex: types, learnable moves, abilities, capabilities, min/max base stats, resists/immunities, and regulation legality. Compound constraints are intersected deterministically. Returns a small preview plus a resultRef when the result is large; page the rest with expand_result.",
    schema: z.object({
      types: z.array(z.string()).optional().describe("Species must carry every listed type."),
      learns: z.array(z.string()).optional().describe("Moves the species must learn."),
      abilities: z.array(z.string()).optional().describe("Abilities (any one) the species must have."),
      capabilities: z.array(z.string()).optional().describe("Engine capability tags (e.g. speed_control, pivot, intimidate)."),
      minStats: z.record(z.string(), z.number()).optional().describe("Minimum base stats by stat name."),
      maxStats: z.record(z.string(), z.number()).optional().describe("Maximum base stats by stat name."),
      resists: z.array(z.string()).optional().describe("Types the species must resist."),
      immunities: z.array(z.string()).optional().describe("Types the species must be immune to."),
      legalOnly: z.boolean().optional().describe("Restrict to the current regulation roster."),
      regulation: z.string().optional().describe("Regulation id to restrict the roster to."),
      sort: z.enum(["num", "name", "bst", "atk", "spe"]).optional().describe("Sort key."),
      limit: z.number().int().min(1).max(100).optional().describe("Page size."),
      offset: z.number().int().min(0).optional().describe("Page offset."),
    }),
  },
);

interface SearchDexArgs {
  types?: string[];
  learns?: string[];
  abilities?: string[];
  capabilities?: string[];
  minStats?: Record<string, number>;
  maxStats?: Record<string, number>;
  resists?: string[];
  immunities?: string[];
  legalOnly?: boolean;
  regulation?: string;
  sort?: "num" | "name" | "bst" | "atk" | "spe";
  limit?: number;
  offset?: number;
}

function meetsBounds(sp: Species, bounds: Record<string, number>, mode: "min" | "max"): boolean {
  for (const [stat, value] of Object.entries(bounds)) {
    const key = stat.toLowerCase();
    const actual = (sp.baseStats as Record<string, number>)[key] ?? sp.baseStats[key as never];
    if (actual === undefined) continue;
    if (mode === "min" && actual < value) return false;
    if (mode === "max" && actual > value) return false;
  }
  return true;
}

function comparator(sort: SearchDexArgs["sort"]) {
  const statKey = sort === "atk" ? "atk" : sort === "spe" ? "spe" : null;
  return (
    a: { id: string; name: string; num: number; bst: number; baseStats: Record<string, number> },
    b: { id: string; name: string; num: number; bst: number; baseStats: Record<string, number> },
  ): number => {
    if (sort === "name") return a.name.localeCompare(b.name);
    if (sort === "bst") return b.bst - a.bst || a.num - b.num;
    if (statKey) return (b.baseStats[statKey] ?? 0) - (a.baseStats[statKey] ?? 0) || a.num - b.num;
    return a.num - b.num;
  };
}

export const expandResultTool = tool(
  async ({ resultRef, offset = 0, limit = 20 }, runtime) => {
    const store = getStore(runtime);
    if (!store) return JSON.stringify({ error: "No store available to expand a stored result." });
    const key = resultRef.startsWith("search:") ? resultRef.slice("search:".length) : resultRef;
    const item = await store.get([SEARCH_NS, getThreadId(runtime)], key);
    if (!item) return JSON.stringify({ error: `No stored result for ref "${resultRef}".` });
    const data = item.value as { total: number; rows: unknown[] };
    return JSON.stringify({ total: data.total, rows: data.rows.slice(offset, offset + limit), offset, limit });
  },
  {
    name: "expand_result",
    description:
      "Page a large stored search result by its resultRef. Use after search_dex returns a resultRef.",
    schema: z.object({
      resultRef: z.string().describe("The resultRef from search_dex."),
      offset: z.number().int().min(0).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }),
  },
);
