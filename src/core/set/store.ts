/**
 * Persistence helpers over the LangGraph BaseStore.
 *
 * Staging (proposals, search results, evidence) is thread-scoped — namespaced
 * by thread id. Saved sets are user-scoped and durable — namespaced by user id,
 * keyed by the canonical content hash (dedup).
 */
import type { BaseStore } from "@langchain/langgraph";
import {
  type CanonicalSet,
  type ProposalArtifact,
  type SavedSet,
  type SetDraft,
  type SetRef,
} from "./model.js";

export const PROPOSALS_NS = "proposals";
export const SETS_NS = "sets";
export const EVIDENCE_NS = "evidence";
export const SEARCH_NS = "search-results";

export function proposalRef(setHash: string): string {
  return `proposal:${setHash}`;
}

export function setRef(hash: string): string {
  return `set:${hash}`;
}

export function evidenceRef(inputHash: string): string {
  return `evidence:${inputHash}`;
}

export function searchResultRef(hash: string): string {
  return `search:${hash}`;
}

export function defaultThreadId(store: BaseStore): string {
  return "default";
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
 * Persist a validated proposal as a saved set. Dedup is by canonical content
 * hash: an identical set already saved returns the existing SetRef (S-9).
 */
export async function saveSet(
  store: BaseStore,
  userId: string,
  proposal: ProposalArtifact,
  opts: { tags?: string[]; basis?: SavedSet["basis"] } = {},
): Promise<{ ref: string; saved: SavedSet; deduped: boolean }> {
  const existing = await store.get([SETS_NS, userId], proposal.hash);
  if (existing) {
    return { ref: setRef(proposal.hash), saved: existing.value as unknown as SavedSet, deduped: true };
  }
  const id = setRef(proposal.hash);
  const saved: SavedSet = {
    id,
    canonicalSet: proposal.canonicalSet,
    basis: opts.basis ?? "proposed",
    origin: { type: proposal.origin.type, sourceRef: proposal.id },
    parentSetRef: proposal.parentRef,
    tags: opts.tags ?? [],
    hash: proposal.hash,
    regulation: proposal.validation.regulation,
    savedAt: new Date().toISOString(),
  };
  await store.put([SETS_NS, userId], proposal.hash, saved as unknown as Record<string, unknown>);
  return { ref: id, saved, deduped: false };
}

/** Re-derive lineage: edit a saved set by staging a new draft whose parent is it. */
export function withParent(draft: SetDraft, parentSetRef: string): SetDraft {
  return { ...draft };
}

export async function listSavedSets(store: BaseStore, userId: string): Promise<SavedSet[]> {
  const items = await store.search([SETS_NS, userId]);
  return items
    .map((i) => i.value as unknown as SavedSet)
    .sort((a, b) => a.savedAt.localeCompare(b.savedAt));
}

export interface SavedSetFilter {
  species?: string;
  regulation?: string;
  basis?: SavedSet["basis"];
  origin?: SavedSet["origin"]["type"];
  tags?: string[];
  intendedAnswers?: string[];
  workflow?: string;
}

function regKey(regulation: string): string {
  return regulation.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function filterSavedSets(sets: SavedSet[], f: SavedSetFilter): SavedSet[] {
  return sets.filter((s) => {
    if (f.species && s.canonicalSet.species.toLowerCase() !== f.species.toLowerCase()) return false;
    if (f.regulation && regKey(s.regulation) !== regKey(f.regulation)) return false;
    if (f.basis && s.basis !== f.basis) return false;
    if (f.origin && s.origin.type !== f.origin) return false;
    if (f.tags?.length && !f.tags.every((t) => s.tags.includes(t))) return false;
    return true;
  });
}

export function canonicalSetToDraft(set: CanonicalSet): SetDraft {
  return {
    species: set.forme ?? set.species,
    item: set.item,
    ability: set.ability,
    nature: set.nature,
    moves: [...set.moves],
    evs: set.evs ? { ...set.evs } : undefined,
  };
}
