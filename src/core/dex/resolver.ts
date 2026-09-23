/**
 * resolve_entity — canonical id -> exact normalized name -> alias -> base/form
 * map -> fuzzy candidates. On `ambiguous` / `fuzzy` the result carries
 * candidates only (CR-6: no silent pick).
 */
import type { ModdedDex, Species } from "@pkmn/dex";
import { getDex, toID, type GenerationNum } from "./dex.js";
import { DATASET_VERSION } from "./indexes.js";

export type ResolutionStatus = "resolved" | "ambiguous" | "fuzzy" | "not_found";

export interface ResolutionCandidate {
  id: string;
  name: string;
  baseSpecies?: string;
  forme?: string;
  types: string[];
}

export interface ResolutionResult {
  status: ResolutionStatus;
  query: string;
  datasetVersion: string;
  resolved?: ResolutionCandidate;
  /** Base/form map: the resolved species plus its alternate forms. */
  forms?: Array<{ id: string; name: string }>;
  /** Present (and authoritative) when status is `ambiguous` or `fuzzy`. */
  candidates?: ResolutionCandidate[];
}

/** Curated competitive aliases; keyed by lowercase alias. */
const ALIASES: Record<string, string> = {
  "ape": "Annihilape",
  "lando": "Landorus",
  "ttar": "Tyranitar",
  "mence": "Salamence",
  "koko": "Tapu Koko",
  "fini": "Tapu Fini",
  "lele": "Tapu Lele",
  "bulu": "Tapu Bulu",
  "geeta": "Gholdengo",
};

function candidate(s: Species): ResolutionCandidate {
  return {
    id: s.id,
    name: s.name,
    baseSpecies: s.baseSpecies && s.baseSpecies !== s.name ? s.baseSpecies : undefined,
    forme: s.forme || undefined,
    types: [...s.types],
  };
}

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

/** All forms of a species (itself included). */
function formsOf(dex: ModdedDex, s: Species): Array<{ id: string; name: string }> {
  const out: Array<{ id: string; name: string }> = [{ id: s.id, name: s.name }];
  for (const name of s.otherFormes ?? []) {
    const f = dex.species.get(name);
    if (f.exists) out.push({ id: f.id, name: f.name });
  }
  return out;
}

export function resolveEntity(query: string, gen: GenerationNum = 9): ResolutionResult {
  const dex = getDex(gen);
  const trimmed = query.trim();
  const normalized = toID(trimmed);

  // 1. canonical id / exact normalized name
  let s = dex.species.get(trimmed);
  if (!s.exists && normalized) s = dex.species.get(normalized);

  // 2. alias
  if (!s.exists) {
    const alias = ALIASES[trimmed.toLowerCase()];
    if (alias) s = dex.species.get(alias);
  }

  if (s.exists) {
    return {
      status: "resolved",
      query: trimmed,
      datasetVersion: DATASET_VERSION,
      resolved: candidate(s),
      forms: formsOf(dex, s),
    };
  }

  // 3. fuzzy candidates (substring + edit distance), candidates only.
  const q = trimmed.toLowerCase();
  const matches: Array<{ s: Species; score: number }> = [];
  for (const sp of dex.species.all()) {
    if (sp.isMega || sp.battleOnly) continue;
    const id = sp.id;
    const name = sp.name.toLowerCase();
    if (!normalized) continue;
    let score = -1;
    if (id === normalized) score = 4;
    else if (id.startsWith(normalized)) score = 3;
    else if (id.includes(normalized)) score = 2;
    else if (name.startsWith(q)) score = 2;
    else if (name.includes(q)) score = 1;
    else {
      const d = Math.min(levenshtein(id, normalized), levenshtein(name, q));
      const threshold = normalized.length <= 4 ? 1 : normalized.length <= 8 ? 2 : 3;
      if (d <= threshold) score = 1 - d * 0.25;
    }
    if (score >= 0) matches.push({ s: sp, score });
  }
  matches.sort((a, b) => b.score - a.score || a.s.id.localeCompare(b.s.id));
  const top = matches.slice(0, 10);

  if (top.length === 0) {
    return { status: "not_found", query: trimmed, datasetVersion: DATASET_VERSION };
  }

  return {
    status: "fuzzy",
    query: trimmed,
    datasetVersion: DATASET_VERSION,
    candidates: top.map((m) => candidate(m.s)),
  };
}
