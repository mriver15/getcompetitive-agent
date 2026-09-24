/**
 * Set lifecycle data models — typed contracts per champions-deepagent-dex-set-
 * lifecycle-spec-v0.4: the typed draft a designer emits, the canonical set it
 * validates into, and the proposal / saved-set / evidence artifacts it persists.
 */
import { createHash } from "node:crypto";
import { z } from "zod";

/** A stat spread on the 0-252 EV scale (the canonical storage scale). */
export type Evs = Record<string, number>;
/** A stat spread on the Champions 0-32-per-stat / 66-total scale. */
export type ChampionsPoints = Record<string, number>;

export type RegulationId = string;
export type CapabilityTag = string;

/** Opaque, stable artifact references (plain strings). */
export type ProposalRef = string;
export type SetRef = string;
export type EvidenceRef = string;
export type SearchResultRef = string;
export type InferenceRef = string;

/**
 * The typed draft the Set Designer emits via `responseFormat`. `moves` is
 * required; `rationale` is a list of concise user-facing reasons (never hidden
 * chain-of-thought).
 */
export const SetDraftSchema = z.object({
  species: z.string().describe("The species (and optional form) to build, e.g. 'Annihilape'."),
  item: z.string().optional().describe("Held item."),
  ability: z.string().optional().describe("Ability."),
  nature: z.string().optional().describe("Nature."),
  moves: z.array(z.string()).max(4).describe("Up to four moves."),
  evs: z.record(z.string(), z.number()).optional().describe("0-252 EVs per stat."),
  championsPoints: z
    .record(z.string(), z.number())
    .optional()
    .describe("Champions stat points: 0-32 per stat, 66 total."),
  role: z.string().optional().describe("The team role this set fills."),
  intendedAnswers: z.array(z.string()).optional().describe("Threats this set is built to answer."),
  intendedPartners: z.array(z.string()).optional().describe("Team members this set partners with."),
  rationale: z.array(z.string()).optional().describe("Concise user-facing reasons for the build."),
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

/** Compact set summary returned to the model by stage_set (full set lives in the artifact). */
export interface SetSummary {
  species: string;
  forme?: string;
  item?: string;
  ability?: string;
  nature?: string;
  moves: string[];
  evs?: Evs;
}

export type ValidationWarning = string;
export type ValidationError = string;

export interface StageSetResult {
  ok: boolean;
  proposalRef?: ProposalRef;
  canonicalSet?: SetSummary;
  legal: boolean;
  warnings: ValidationWarning[];
  errors: ValidationError[];
  setHash?: string;
  evidenceRefs: EvidenceRef[];
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
 * ability, nature, moves, IVs, EVs, level. Identical sets hash identically;
 * rationale/tags/labels/createdAt are excluded.
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
  id: ProposalRef;
  canonicalSet: CanonicalSet;
  basis: "proposed";
  origin: {
    type: "agent";
    workflow: "set-designer" | "team-doctor" | "build-around" | "matchup-prep" | string;
  };
  regulation?: RegulationId;
  goal?: string;
  rationale: string[];
  intendedAnswers?: string[];
  evidenceRefs: EvidenceRef[];
  parentRef?: SetRef | ProposalRef;
  validation: {
    legal: boolean;
    datasetVersion: string;
    checkedAt: string;
  };
  hash: string;
  createdAt: string;
}

export interface SavedSet {
  id: SetRef;
  set: CanonicalSet;
  basis: "proposed" | "inferred";
  origin: {
    type: "agent" | "user" | "battle";
    workflow?: string;
  };
  regulation?: RegulationId;
  rationale: string[];
  intendedAnswers?: string[];
  evidenceRefs: EvidenceRef[];
  parentSetRef?: SetRef;
  tags: string[];
  validation: {
    legal: boolean;
    datasetVersion: string;
    checkedAt: string;
  };
  hash: string;
  createdAt: string;
}
