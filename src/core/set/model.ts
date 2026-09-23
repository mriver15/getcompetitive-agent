/**
 * Set lifecycle data models: the typed draft a designer emits, the canonical
 * set it validates into, and the proposal/saved-set artifacts it persists.
 */
import { createHash } from "node:crypto";
import { z } from "zod";

/** A stat spread on the 0-252 EV scale (the canonical storage scale). */
export type Evs = Record<string, number>;
/** A stat spread on the Champions 0-32-per-stat / 66-total scale. */
export type ChampionsPoints = Record<string, number>;

/**
 * The typed draft the Set Designer emits via `responseFormat`. Free text is
 * never re-parsed into this shape.
 */
export const SetDraftSchema = z.object({
  species: z.string().describe("The species (and optional form) to build, e.g. 'Annihilape'."),
  item: z.string().optional().describe("Held item."),
  ability: z.string().optional().describe("Ability."),
  nature: z.string().optional().describe("Nature."),
  moves: z.array(z.string()).max(4).optional().describe("Up to four moves."),
  evs: z.record(z.string(), z.number()).optional().describe("0-252 EVs per stat."),
  championsPoints: z
    .record(z.string(), z.number())
    .optional()
    .describe("Champions stat points: 0-32 per stat, 66 total."),
  role: z.string().optional().describe("The team role this set fills."),
  intendedAnswers: z.array(z.string()).optional().describe("Threats this set is built to answer."),
  intendedPartners: z.array(z.string()).optional().describe("Team members this set partners with."),
  rationale: z.string().optional().describe("Why this build (kept as rationale, never hidden CoT)."),
  regulation: z.string().optional().describe("Regulation set id, e.g. 'm-c'."),
});
export type SetDraft = z.infer<typeof SetDraftSchema>;

/** The canonical, validated set. Everything here is engine-resolved. */
export interface CanonicalSet {
  species: string;
  forme?: string;
  item?: string;
  ability?: string;
  nature?: string;
  moves: string[];
  ivs?: Evs;
  /** The canonical EV spread (Champions points are converted here). */
  evs?: Evs;
  level: number;
}

export interface StageSetResult {
  legal: boolean;
  warnings: string[];
  errors: string[];
  setHash: string;
  canonicalSet: CanonicalSet;
  regulation: string;
}

/** Opaque, stable reference to a staged proposal. */
export interface ProposalRef {
  ref: string;
  kind: "proposal";
}

/** Opaque, stable reference to a saved set. */
export interface SetRef {
  ref: string;
  kind: "set";
}

/** Opaque, stable reference to a benchmark evidence artifact. */
export interface EvidenceRef {
  ref: string;
  kind: "evidence";
}

/** Opaque, stable reference to a large, paged search result. */
export interface SearchResultRef {
  ref: string;
  kind: "search_result";
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function sortKeys(record: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of Object.keys(record).sort()) out[k] = record[k];
  return out;
}

/**
 * Canonical content hash — the dedup key (S-9). Fields: species/form, item,
 * ability, nature, moves, IVs, EVs, level. Identical sets hash identically.
 */
export function canonicalHash(set: CanonicalSet): string {
  const canonical = {
    species: set.species,
    forme: set.forme ?? null,
    item: set.item ?? null,
    ability: set.ability ?? null,
    nature: set.nature ?? null,
    moves: [...set.moves].sort(),
    ivs: sortKeys(set.ivs ?? {}),
    evs: sortKeys(set.evs ?? {}),
    level: set.level,
  };
  return sha256(JSON.stringify(canonical));
}

export interface ProposalArtifact {
  id: string;
  canonicalSet: CanonicalSet;
  basis: "proposed";
  origin: { type: "agent" };
  rationale?: string;
  evidenceRefs: string[];
  parentRef?: string;
  validation: { legal: boolean; warnings: string[]; errors: string[]; regulation: string };
  hash: string;
  createdAt: string;
}

export interface SavedSet {
  id: string;
  canonicalSet: CanonicalSet;
  basis: "proposed" | "inferred";
  origin: { type: "agent" | "user"; sourceRef?: string };
  parentSetRef?: string;
  tags: string[];
  hash: string;
  regulation: string;
  savedAt: string;
}
