/**
 * Evidence model — every empirical claim is backed by a content-addressed
 * EvidenceArtifact with a provenance class (CR-3). `read_evidence` returns a
 * compact summary, never the full result.
 */
import type { BaseStore } from "@langchain/langgraph";
import { sha256 } from "../set/model.js";
import { EVIDENCE_NS, evidenceRef } from "../set/store.js";

export type Provenance = "DEX" | "META" | "ENGINE" | "INFERENCE";

export interface EvidenceArtifact {
  id: string;
  provenance: Provenance;
  kind: string;
  inputHash: string;
  artifactHash: string;
  result: unknown;
  createdAt: string;
}

export function buildEvidence(
  provenance: Provenance,
  kind: string,
  input: unknown,
  result: unknown,
): EvidenceArtifact {
  const inputHash = sha256(JSON.stringify(input));
  const artifactHash = sha256(JSON.stringify({ input, result }));
  return {
    id: evidenceRef(inputHash),
    provenance,
    kind,
    inputHash,
    artifactHash,
    result,
    createdAt: new Date().toISOString(),
  };
}

export async function writeEvidence(
  store: BaseStore,
  threadId: string,
  artifact: EvidenceArtifact,
): Promise<void> {
  await store.put([EVIDENCE_NS, threadId], artifact.id, artifact as unknown as Record<string, unknown>);
}

export async function readEvidenceArtifact(
  store: BaseStore,
  threadId: string,
  ref: string,
): Promise<EvidenceArtifact | null> {
  const id = ref.startsWith("evidence:") ? ref : `evidence:${ref}`;
  const item = await store.get([EVIDENCE_NS, threadId], id);
  return item ? (item.value as unknown as EvidenceArtifact) : null;
}

/** Compact summary — provenance + kind + the result, without the raw input. */
export function summarizeEvidence(a: EvidenceArtifact): Record<string, unknown> {
  return {
    ref: a.id,
    provenance: a.provenance,
    kind: a.kind,
    result: a.result,
    createdAt: a.createdAt,
  };
}
