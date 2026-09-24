/**
 * Dex query tools (spec §6-§12): resolve_entity, lookup_fact, search_dex,
 * expand_result. Deterministic logic only; the model routes, these prove.
 */
import { tool } from "langchain";
import { z } from "zod";
import {
  getDex,
  toID,
  typeEffectiveness,
} from "../core/dex/dex.js";
import { getDexIndexes, intersectSpecies, DATASET_VERSION } from "../core/dex/indexes.js";
import { resolveEntity, type EntityType } from "../core/dex/resolver.js";
import { projectSpecies, projectMove, projectItem, projectAbility, projectNature } from "../core/dex/projections.js";
import { getRegulationSet } from "../core/dex/regulations.js";
import { sha256 } from "../core/set/model.js";
import { SEARCH_NS } from "../core/set/store.js";
import { getThreadId, getStore } from "./runtime.js";

const GEN = 9;

const ENTITY_KIND = z.enum(["species", "move", "item", "ability", "nature"]);

export const resolveEntityTool = tool(
  async ({ query, kind }: { query: string; kind?: EntityType }) =>
    JSON.stringify(resolveEntity(query, { kind, gen: GEN })),
  {
    name: "resolve_entity",
    description:
      "Resolve an entity name to its canonical form (canonical id -> exact name -> alias -> base/form -> fuzzy candidates). Use before lookup_fact or stage_set when a name may be a form, alias, or typo. On fuzzy/ambiguous it returns candidates only, never a silent pick.",
    schema: z.object({
      query: z.string().describe("The name to resolve."),
      kind: ENTITY_KIND.optional().describe("Entity type; defaults to species."),
    }),
  },
);

export const lookupFactTool = tool(
  async ({
    kind,
    names,
    fields,
    regulation,
    moveFilters,
  }: {
    kind: EntityType;
    names: string[];
    fields: string[];
    regulation?: string;
    moveFilters?: { types?: string[]; categories?: Array<"Physical" | "Special" | "Status">; minBasePower?: number; maxBasePower?: number };
  }) => {
    const dex = getDex(GEN);
    const results: Array<Record<string, unknown>> = [];

    for (const name of names) {
      const res = resolveEntity(name, { kind, gen: GEN });
      if (!res.canonicalId || !res.canonicalName) {
        results.push({ name, status: res.status, candidates: res.candidates ?? [] });
        continue;
      }
      let projected: Record<string, unknown>;
      switch (kind) {
        case "species": {
          projected = await projectSpecies(dex.species.get(res.canonicalName), fields, moveFilters);
          if (regulation) projected.legalIn = isLegalIn(dex.species.get(res.canonicalName), regulation);
          break;
        }
        case "move":
          projected = projectMove(dex.moves.get(res.canonicalName), fields);
          break;
        case "item":
          projected = projectItem(dex.items.get(res.canonicalName), fields);
          break;
        case "ability":
          projected = projectAbility(dex.abilities.get(res.canonicalName), fields);
          break;
        case "nature":
          projected = projectNature(dex.natures.get(res.canonicalName), fields);
          break;
      }
      results.push(projected);
    }

    return JSON.stringify({ datasetVersion: DATASET_VERSION, results });
  },
  {
    name: "lookup_fact",
    description:
      "Atomic lookup with a required fields projection. Returns only the requested fields plus identity (id/name). Batch many names in one call. Use for specific known facts about named entities (typing, base stats, abilities, move data, items, natures, a small learnset slice, or form relationships). For a species' learnable moves, narrow with moveFilters (type / category / base power).",
    schema: z.object({
      kind: ENTITY_KIND.describe("Entity type to look up."),
      names: z.array(z.string()).min(1).describe("Entity names to resolve and look up."),
      fields: z.array(z.string()).describe("Fields to project (e.g. 'types', 'baseStats.spe'). Only these plus identity are returned."),
      regulation: z.string().optional().describe("Regulation id to also report legalIn (species kind)."),
      moveFilters: z
        .object({
          types: z.array(z.string()).optional().describe("Keep only moves of these types."),
          categories: z.array(z.enum(["Physical", "Special", "Status"])).optional().describe("Keep only these move categories (Status = non-damaging)."),
          minBasePower: z.number().int().min(0).optional().describe("Minimum base power."),
          maxBasePower: z.number().int().min(0).optional().describe("Maximum base power."),
        })
        .optional()
        .describe("Narrow the 'moves' field. When set, moves are returned as {name, type, category, basePower}."),
    }),
  },
);

function isLegalIn(sp: { baseSpecies?: string; name: string }, regulation: string): boolean {
  const set = getRegulationSet(regulation.toLowerCase().replace(/[^a-z0-9]/g, ""));
  if (!set) return false;
  const base = sp.baseSpecies && sp.baseSpecies !== sp.name ? sp.baseSpecies : sp.name;
  return set.eligibleSpecies.map(toID).includes(toID(base));
}

const SEARCH_FILTERS = z.object({
  typesAll: z.array(z.string()).optional(),
  typesAny: z.array(z.string()).optional(),
  learnsAll: z.array(z.string()).optional(),
  learnsAny: z.array(z.string()).optional(),
  abilitiesAny: z.array(z.string()).optional(),
  capabilitiesAll: z.array(z.string()).optional(),
  capabilitiesAny: z.array(z.string()).optional(),
  minBaseStats: z.record(z.string(), z.number()).optional(),
  maxBaseStats: z.record(z.string(), z.number()).optional(),
  resistsAny: z.array(z.string()).optional(),
  immuneToAny: z.array(z.string()).optional(),
  legalOnly: z.boolean().optional(),
});

export const searchDexTool = tool(
  async (
    args: {
      entity: "species";
      regulation?: string;
      filters?: z.infer<typeof SEARCH_FILTERS>;
      fields?: string[];
      sort?: { field: string; direction: "asc" | "desc" };
      limit?: number;
      offset?: number;
    },
    runtime,
  ) => {
    const indexes = await getDexIndexes(GEN);
    const dex = getDex(GEN);
    const f = args.filters ?? {};

    // Universe: all base species, a named regulation roster, or the current legal roster.
    let universe = new Set(indexes.baseSpeciesById.keys());
    if (args.regulation) {
      const roster = indexes.regulationToSpecies.get(args.regulation.toLowerCase().replace(/[^a-z0-9]/g, ""));
      if (roster) universe = new Set(roster);
    } else if (f.legalOnly) {
      const current = getRegulationSet("m-c");
      if (current) universe = new Set(current.eligibleSpecies.map(toID));
    }

    const constraintSets: Array<Set<string> | undefined> = [];

    // types: all (intersection) or any (union).
    if (f.typesAll?.length) {
      for (const t of f.typesAll) {
        const s = indexes.typesToSpecies.get(toID(t));
        if (!s) return JSON.stringify({ total: 0, preview: [], note: `Unknown type "${t}".` });
        constraintSets.push(s);
      }
    }
    if (f.typesAny?.length) {
      const union = new Set<string>();
      for (const t of f.typesAny) {
        const s = indexes.typesToSpecies.get(toID(t));
        if (!s) return JSON.stringify({ total: 0, preview: [], note: `Unknown type "${t}".` });
        for (const id of s) union.add(id);
      }
      constraintSets.push(union);
    }

    // learns: all (intersection) or any (union).
    if (f.learnsAll?.length) {
      for (const m of f.learnsAll) {
        const s = indexes.movesToSpecies.get(toID(m));
        if (!s) return JSON.stringify({ total: 0, preview: [], note: `No species learns "${m}".` });
        constraintSets.push(s);
      }
    }
    if (f.learnsAny?.length) {
      const union = new Set<string>();
      for (const m of f.learnsAny) {
        const s = indexes.movesToSpecies.get(toID(m));
        if (s) for (const id of s) union.add(id);
      }
      constraintSets.push(union);
    }

    // abilities: any.
    if (f.abilitiesAny?.length) {
      const union = new Set<string>();
      for (const a of f.abilitiesAny) {
        const s = indexes.abilitiesToSpecies.get(toID(a));
        if (s) for (const id of s) union.add(id);
      }
      constraintSets.push(union);
    }

    // capabilities: all (intersection) or any (union).
    if (f.capabilitiesAll?.length) {
      for (const cap of f.capabilitiesAll) {
        const s = indexes.capabilitiesToSpecies.get(cap);
        if (!s) return JSON.stringify({ total: 0, preview: [], note: `Unknown capability "${cap}".` });
        constraintSets.push(s);
      }
    }
    if (f.capabilitiesAny?.length) {
      const union = new Set<string>();
      for (const cap of f.capabilitiesAny) {
        const s = indexes.capabilitiesToSpecies.get(cap);
        if (s) for (const id of s) union.add(id);
      }
      constraintSets.push(union);
    }

    constraintSets.push(universe);
    const hits = intersectSpecies(indexes, constraintSets);

    const rows: Array<{ id: string; name: string; num: number; types: string[]; baseStats: Record<string, number>; bst: number }> = [];
    for (const id of hits) {
      const sp = indexes.speciesById.get(id);
      if (!sp) continue;
      if (f.minBaseStats && !meetsBounds(sp.baseStats, f.minBaseStats, "min")) continue;
      if (f.maxBaseStats && !meetsBounds(sp.baseStats, f.maxBaseStats, "max")) continue;
      if (f.resistsAny?.length && !f.resistsAny.some((t) => typeEffectiveness(t, sp.types, GEN) < 1)) continue;
      if (f.immuneToAny?.length && !f.immuneToAny.some((t) => typeEffectiveness(t, sp.types, GEN) === 0)) continue;
      rows.push({ id: sp.id, name: sp.name, num: sp.num, types: [...sp.types], baseStats: { ...sp.baseStats }, bst: sp.bst });
    }

    rows.sort(comparator(args.sort ?? { field: "num", direction: "asc" }));

    const total = rows.length;
    const limit = args.limit ?? 20;
    const offset = args.offset ?? 0;
    const page = rows.slice(offset, offset + limit);
    const fields = args.fields ?? [];

    // Preview projection: requested fields + identity, or identity only.
    const preview = page.map((r) => projectRow(indexes.speciesById.get(r.id)!, fields, dex));

    // Large results: store the full entity-id list as an immutable artifact.
    const store = getStore(runtime);
    if (total > limit && store) {
      const key = sha256(JSON.stringify(args));
      await store.put([SEARCH_NS, getThreadId(runtime)], key, {
        id: `search:${key}`,
        query: args,
        entityIds: rows.map((r) => r.id),
        datasetVersion: DATASET_VERSION,
        createdAt: new Date().toISOString(),
        hash: key,
      });
      return JSON.stringify({ total, resultRef: `search:${key}`, preview });
    }

    return JSON.stringify({ total, preview });
  },
  {
    name: "search_dex",
    description:
      "Typed, deterministic constraint search over the Champions dex: types, learnable moves, abilities, capabilities, min/max base stats, resists/immunities, and regulation legality. Compound constraints are intersected in code. Returns a projected preview plus a resultRef when the result is large; page the rest with expand_result.",
    schema: z.object({
      entity: z.literal("species").describe("Entity type; always species."),
      regulation: z.string().optional().describe("Regulation id to restrict the roster to."),
      filters: SEARCH_FILTERS.optional(),
      fields: z.array(z.string()).optional().describe("Fields to project into the preview."),
      sort: z.object({ field: z.string(), direction: z.enum(["asc", "desc"]) }).optional(),
      limit: z.number().int().min(1).max(100).optional(),
      offset: z.number().int().min(0).optional(),
    }),
  },
);

function projectRow(sp: { name: string; id: string; num: number }, fields: string[], dex: ReturnType<typeof getDex>) {
  const out: Record<string, unknown> = { id: sp.id, name: sp.name, num: sp.num };
  for (const f of fields) {
    const s = dex.species.get(sp.name);
    if (!s.exists) continue;
    if (f === "types") out.types = [...s.types];
    else if (f === "baseStats") out.baseStats = { ...s.baseStats };
    else if (f.startsWith("baseStats.")) {
      const stat = f.slice("baseStats.".length) as keyof typeof s.baseStats;
      out[f] = s.baseStats[stat];
    } else if (f === "bst") out.bst = s.bst;
    else if (f === "abilities") out.abilities = s.abilities;
  }
  return out;
}

function meetsBounds(baseStats: Record<string, number>, bounds: Record<string, number>, mode: "min" | "max"): boolean {
  for (const [stat, value] of Object.entries(bounds)) {
    const key = stat.toLowerCase();
    const actual = (baseStats as Record<string, number>)[key];
    if (actual === undefined) continue;
    if (mode === "min" && actual < value) return false;
    if (mode === "max" && actual > value) return false;
  }
  return true;
}

function comparator(sort: { field: string; direction: "asc" | "desc" }) {
  const dir = sort.direction === "desc" ? -1 : 1;
  return (
    a: { name: string; num: number; bst: number; baseStats: Record<string, number> },
    b: { name: string; num: number; bst: number; baseStats: Record<string, number> },
  ): number => {
    const field = sort.field;
    if (field === "name") return a.name.localeCompare(b.name) * dir;
    if (field === "bst") return (a.bst - b.bst) * dir || (a.num - b.num);
    if (field === "num") return (a.num - b.num) * dir;
    const av = (a.baseStats as Record<string, number>)[field.toLowerCase()] ?? 0;
    const bv = (b.baseStats as Record<string, number>)[field.toLowerCase()] ?? 0;
    return (av - bv) * dir || (a.num - b.num);
  };
}

export const expandResultTool = tool(
  async (
    { resultRef, offset = 0, limit = 20, fields = [] }: { resultRef: string; offset?: number; limit?: number; fields?: string[] },
    runtime,
  ) => {
    const store = getStore(runtime);
    if (!store) return JSON.stringify({ error: "No store available to expand a stored result." });
    const key = resultRef.startsWith("search:") ? resultRef.slice("search:".length) : resultRef;
    const item = await store.get([SEARCH_NS, getThreadId(runtime)], key);
    if (!item) return JSON.stringify({ error: `No stored result for ref "${resultRef}".` });
    const data = item.value as { entityIds: string[] };
    const dex = getDex(GEN);
    const rows = data.entityIds
      .slice(offset, offset + limit)
      .map((id) => projectRow(dex.species.get(id), fields, dex));
    return JSON.stringify({ total: data.entityIds.length, rows, offset, limit });
  },
  {
    name: "expand_result",
    description: "Page a large stored search result by its resultRef. Use after search_dex returns a resultRef.",
    schema: z.object({
      resultRef: z.string().describe("The resultRef from search_dex."),
      offset: z.number().int().min(0).optional(),
      limit: z.number().int().min(1).max(100).optional(),
      fields: z.array(z.string()).optional().describe("Fields to project into each row."),
    }),
  },
);
