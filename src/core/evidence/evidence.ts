/**
 * Evidence model (spec §33) — every empirical claim is backed by a
 * content-addressed EvidenceArtifact with a provenance class (CR-3).
 * `read_evidence` returns a compact summary, never the full raw input.
 */
import type { BaseStore } from "@langchain/langgraph";
import { sha256 } from "../set/model.js";
import { EVIDENCE_NS, evidenceRef } from "../set/store.js";

export type Provenance = "DEX" | "META" | "ENGINE" | "INFERENCE";

export interface EvidenceArtifact {
  id: string;
  operation: string;
  provenance: Provenance;
  inputHash: string;
  artifactHash: string;
  datasetVersion?: string;
  sourceAsOf?: string;
  sampleSize?: number;
  result: unknown;
  createdAt: string;
}

export function buildEvidence(
  provenance: Provenance,
  operation: string,
  input: unknown,
  result: unknown,
  opts: { datasetVersion?: string; sourceAsOf?: string; sampleSize?: number } = {},
): EvidenceArtifact {
  const inputHash = sha256(JSON.stringify(input));
  const artifactHash = sha256(JSON.stringify({ input, result }));
  return {
    id: evidenceRef(inputHash),
    operation,
    provenance,
    inputHash,
    artifactHash,
    datasetVersion: opts.datasetVersion,
    sourceAsOf: opts.sourceAsOf,
    sampleSize: opts.sampleSize,
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

/** Compact summary — provenance + operation + result, without the raw input. */
export function summarizeEvidence(a: EvidenceArtifact): Record<string, unknown> {
  return {
    evidenceRef: a.id,
    operation: a.operation,
    provenance: a.provenance,
    datasetVersion: a.datasetVersion,
    sourceAsOf: a.sourceAsOf,
    sampleSize: a.sampleSize,
    result: a.result,
  };
}
