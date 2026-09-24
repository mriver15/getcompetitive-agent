/**
 * Deterministic entity resolution (spec §6).
 *
 * Chain: canonical ID -> exact normalized name -> known alias -> base/form
 * mapping -> fuzzy candidates. On `fuzzy` / `ambiguous` the result carries
 * candidates only — never a silent selection (CR-6).
 */
import type { ModdedDex } from "@pkmn/dex";
import { getDex, toID, type GenerationNum } from "./dex.js";
import { getChampionsRoster } from "./regulations.js";

export type EntityType = "species" | "move" | "item" | "ability" | "nature";
export type ResolutionStatus = "exact" | "alias" | "form" | "fuzzy" | "ambiguous" | "not_found";

export interface ResolutionCandidate {
  id: string;
  name: string;
  score?: number;
}

export interface ResolutionResult {
  status: ResolutionStatus;
  entityType?: EntityType;
  canonicalId?: string;
  canonicalName?: string;
  candidates?: ResolutionCandidate[];
}

/** Curated competitive species aliases; keyed by lowercase alias. */
const ALIASES: Record<string, string> = {
  "ape": "Annihilape",
  "lando": "Landorus",
  "lando-t": "Landorus-Therian",
  "ttar": "Tyranitar",
  "mence": "Salamence",
  "koko": "Tapu Koko",
  "fini": "Tapu Fini",
  "lele": "Tapu Lele",
  "bulu": "Tapu Bulu",
  "goldengo": "Gholdengo",
  "cress": "Cresselia",
  "dozo": "Dondozo",
  "pult": "Dragapult",
};

/** Classic Levenshtein edit distance between two lowercase strings. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return curr[b.length];
}

interface FuzzyHit {
  id: string;
  name: string;
  score: number;
}

function fuzzyHits(
  entries: Array<{ id: string; name: string }>,
  normalized: string,
  query: string,
): FuzzyHit[] {
  const hits: FuzzyHit[] = [];
  for (const e of entries) {
    const id = e.id;
    const name = e.name.toLowerCase();
    let score = -1;
    if (id === normalized) score = 4;
    else if (id.startsWith(normalized)) score = 3;
    else if (id.includes(normalized)) score = 2;
    else if (name.startsWith(query)) score = 2;
    else if (name.includes(query)) score = 1;
    else {
      const d = Math.min(levenshtein(id, normalized), levenshtein(name, query));
      const threshold = normalized.length <= 4 ? 1 : normalized.length <= 8 ? 2 : 3;
      if (d <= threshold) score = 1 - d * 0.25;
    }
    if (score >= 0) hits.push({ id, name: e.name, score });
  }
  hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return hits;
}

function fuzzyResult(entityType: EntityType, hits: FuzzyHit[]): ResolutionResult {
  if (hits.length === 0) return { status: "not_found", entityType, candidates: [] };
  const top = hits[0].score;
  const tied = hits.filter((h) => h.score === top);
  return {
    status: tied.length > 1 ? "ambiguous" : "fuzzy",
    entityType,
    candidates: hits.slice(0, 10).map((h) => ({ id: h.id, name: h.name, score: h.score })),
  };
}

function isForm(s: { forme?: string; baseSpecies?: string; name: string }): boolean {
  return !!s.forme || (!!s.baseSpecies && s.baseSpecies !== s.name);
}

function resolveSpecies(dex: ModdedDex, query: string, normalized: string): ResolutionResult {
  const roster = getChampionsRoster();
  const inRoster = (s: { num: number; baseSpecies?: string; name: string }) =>
    s.num >= 1 && roster.has(toID(s.baseSpecies || s.name));

  const direct = dex.species.get(query);
  if (direct.exists && inRoster(direct)) {
    return {
      status: isForm(direct) ? "form" : "exact",
      entityType: "species",
      canonicalId: direct.id,
      canonicalName: direct.name,
    };
  }
  const alias = ALIASES[query.toLowerCase()];
  if (alias) {
    const s = dex.species.get(alias);
    if (s.exists && inRoster(s)) {
      return { status: "alias", entityType: "species", canonicalId: s.id, canonicalName: s.name };
    }
  }
  const entries = dex.species
    .all()
    .filter((s) => !s.isMega && !s.battleOnly && s.num >= 1 && roster.has(toID(s.baseSpecies || s.name)))
    .map((s) => ({ id: s.id, name: s.name }));
  return fuzzyResult("species", fuzzyHits(entries, normalized, query));
}

function resolveByTable(
  entityType: Exclude<EntityType, "species">,
  get: (q: string) => { exists: boolean; id: string; name: string },
  all: () => readonly { id: string; name: string }[],
  query: string,
  normalized: string,
): ResolutionResult {
  const direct = get(query);
  if (direct.exists) {
    return { status: "exact", entityType, canonicalId: direct.id, canonicalName: direct.name };
  }
  return fuzzyResult(entityType, fuzzyHits(all().map((e) => ({ id: e.id, name: e.name })), normalized, query));
}

export interface ResolveOptions {
  kind?: EntityType;
  gen?: GenerationNum;
}

export function resolveEntity(query: string, opts: ResolveOptions = {}): ResolutionResult {
  const gen = opts.gen ?? 9;
  const dex = getDex(gen);
  const trimmed = query.trim();
  const normalized = toID(trimmed);

  switch (opts.kind ?? "species") {
    case "species":
      return resolveSpecies(dex, trimmed, normalized);
    case "move":
      return resolveByTable("move", (q) => dex.moves.get(q), () => dex.moves.all(), trimmed, normalized);
    case "item":
      return resolveByTable("item", (q) => dex.items.get(q), () => dex.items.all(), trimmed, normalized);
    case "ability":
      return resolveByTable("ability", (q) => dex.abilities.get(q), () => dex.abilities.all(), trimmed, normalized);
    case "nature":
      return resolveByTable("nature", (q) => dex.natures.get(q), () => dex.natures.all(), trimmed, normalized);
  }
}
