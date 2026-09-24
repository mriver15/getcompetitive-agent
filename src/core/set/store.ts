/**
 * Persistence helpers over the LangGraph BaseStore (spec §22, §28).
 *
 * Staging (proposals, search results, evidence) is thread-scoped — namespaced
 * by thread id. Saved sets are user-scoped and durable — namespaced by user id,
 * keyed by the canonical content hash (dedup, S-9).
 */
import type { BaseStore } from "@langchain/langgraph";
import {
  type CanonicalSet,
  type ProposalArtifact,
  type ProposalRef,
  type RegulationId,
  type SavedSet,
  type SetDraft,
  type SetRef,
  type StageSetResult,
} from "./model.js";
import { DATASET_VERSION } from "../dex/indexes.js";

export const PROPOSALS_NS = "proposals";
export const SETS_NS = "sets";
export const EVIDENCE_NS = "evidence";
export const SEARCH_NS = "search-results";

export function proposalRef(setHash: string): ProposalRef {
  return `proposal:${setHash}`;
}

export function setRef(hash: string): SetRef {
  return `set:${hash}`;
}

export function evidenceRef(inputHash: string): string {
  return `evidence:${inputHash}`;
}

export function searchResultRef(hash: string): string {
  return `search:${hash}`;
}

/** Build the proposal artifact from a staged draft (never contains hidden CoT). */
export function buildProposalArtifact(
  result: StageSetResult,
  canonicalSet: CanonicalSet,
  draft: SetDraft,
  opts: { regulation?: RegulationId; goal?: string; parentSetRef?: SetRef | ProposalRef; workflow?: string } = {},
): ProposalArtifact {
  return {
    id: result.proposalRef as ProposalRef,
    canonicalSet,
    basis: "proposed",
    origin: { type: "agent", workflow: opts.workflow ?? "set-designer" },
    regulation: draft.regulation ?? opts.regulation,
    goal: opts.goal,
    rationale: draft.rationale ?? [],
    intendedAnswers: draft.intendedAnswers,
    evidenceRefs: result.evidenceRefs,
    parentRef: opts.parentSetRef,
    validation: {
      legal: result.legal,
      datasetVersion: DATASET_VERSION,
      checkedAt: new Date().toISOString(),
    },
    hash: result.setHash as string,
    createdAt: new Date().toISOString(),
  };
}

export async function writeProposal(
  store: BaseStore,
  threadId: string,
  artifact: ProposalArtifact,
): Promise<void> {
  await store.put([PROPOSALS_NS, threadId], artifact.id, artifact as unknown as Record<string, unknown>);
}

export async function readProposal(
  store: BaseStore,
  threadId: string,
  ref: string,
): Promise<ProposalArtifact | null> {
  const id = ref.startsWith("proposal:") ? ref : `proposal:${ref}`;
  const item = await store.get([PROPOSALS_NS, threadId], id);
  return item ? (item.value as unknown as ProposalArtifact) : null;
}

export async function readSearchResult(
  store: BaseStore,
  threadId: string,
  ref: string,
): Promise<unknown | null> {
  const id = ref.startsWith("search:") ? ref : `search:${ref}`;
  const item = await store.get([SEARCH_NS, threadId], id);
  return item ? item.value : null;
}

export async function writeSearchResult(
  store: BaseStore,
  threadId: string,
  key: string,
  value: Record<string, unknown>,
): Promise<void> {
  await store.put([SEARCH_NS, threadId], key, value);
}

/**
 * Commit a validated proposal to the user's Set Library. Dedup by canonical
 * content hash: an identical set returns the existing SetRef (S-9).
 */
export async function saveSet(
  store: BaseStore,
  userId: string,
  proposal: ProposalArtifact,
  opts: { label?: string; tags?: string[] } = {},
): Promise<{ ref: SetRef; saved: SavedSet; deduped: boolean }> {
  const existing = await store.get([SETS_NS, userId], proposal.hash);
  if (existing) {
    return { ref: setRef(proposal.hash), saved: existing.value as unknown as SavedSet, deduped: true };
  }
  const id = setRef(proposal.hash);
  const tags = [...(opts.label ? [opts.label] : []), ...(opts.tags ?? [])];
  const saved: SavedSet = {
    id,
    set: proposal.canonicalSet,
    basis: proposal.basis,
    origin: { type: proposal.origin.type, workflow: proposal.origin.workflow },
    regulation: proposal.regulation,
    rationale: proposal.rationale,
    intendedAnswers: proposal.intendedAnswers,
    evidenceRefs: proposal.evidenceRefs,
    parentSetRef: proposal.parentRef as SetRef | undefined,
    tags,
    validation: proposal.validation,
    hash: proposal.hash,
    createdAt: new Date().toISOString(),
  };
  await store.put([SETS_NS, userId], proposal.hash, saved as unknown as Record<string, unknown>);
  return { ref: id, saved, deduped: false };
}

export async function listSavedSets(store: BaseStore, userId: string): Promise<SavedSet[]> {
  const items = await store.search([SETS_NS, userId]);
  return items
    .map((i) => i.value as unknown as SavedSet)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export interface SavedSetFilter {
  species?: string[];
  regulation?: RegulationId;
  basis?: Array<"proposed" | "inferred">;
  origin?: Array<"agent" | "user" | "battle">;
  tagsAny?: string[];
  intendedAnswers?: string[];
  workflow?: string;
  limit?: number;
}

function regKey(regulation: string): string {
  return regulation.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function filterSavedSets(sets: SavedSet[], f: SavedSetFilter): SavedSet[] {
  const filtered = sets.filter((s) => {
    if (f.species?.length && !f.species.some((n) => s.set.species.toLowerCase() === n.toLowerCase())) return false;
    if (f.regulation && regKey(s.regulation ?? "") !== regKey(f.regulation)) return false;
    if (f.basis?.length && !f.basis.includes(s.basis)) return false;
    if (f.origin?.length && !f.origin.includes(s.origin.type)) return false;
    if (f.tagsAny?.length && !f.tagsAny.some((t) => s.tags.includes(t))) return false;
    if (f.intendedAnswers?.length && !f.intendedAnswers.some((a) => (s.intendedAnswers ?? []).some((x) => x.toLowerCase() === a.toLowerCase()))) return false;
    if (f.workflow && s.origin.workflow !== f.workflow) return false;
    return true;
  });
  return f.limit !== undefined ? filtered.slice(0, f.limit) : filtered;
}
