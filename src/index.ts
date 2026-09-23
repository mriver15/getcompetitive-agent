/**
 * getcompetitive-agent — public surface.
 */
export {
  buildChampionsAgent,
  resolveEntityTool,
  lookupFactTool,
  searchDexTool,
  expandResultTool,
  stageSetTool,
  saveSetTool,
  searchSavedSetsTool,
  calculateDamageTool,
  calculateSpeedTool,
  optimizeSpreadTool,
  readEvidenceTool,
  buildSetDesignerGraph,
  SetDraftSchema,
  doctrineGuardMiddleware,
  contextSchema,
  championsStateSchema,
  SYSTEM_PROMPT,
  type BuildChampionsAgentOptions,
} from "./agent.js";

export { resolveEntity, type ResolutionResult, type ResolutionCandidate } from "./core/dex/resolver.js";
export { getDexIndexes, DATASET_VERSION, REGULATION_VERSION, intersectSpecies } from "./core/dex/indexes.js";
export { CAPABILITIES, buildCapabilityIndex } from "./core/dex/capabilities.js";
export { REGULATION_SETS, getRegulationSet, type RegulationSet } from "./core/dex/regulations.js";
export { stageSet, type StageOptions } from "./core/set/stage.js";
export {
  SetDraftSchema as SetDraftZodSchema,
  canonicalHash,
  sha256,
  type SetDraft,
  type CanonicalSet,
  type StageSetResult,
  type ProposalArtifact,
  type SavedSet,
  type ProposalRef,
  type SetRef,
  type EvidenceRef,
  type SearchResultRef,
} from "./core/set/model.js";
export {
  saveSet,
  readProposal,
  writeProposal,
  listSavedSets,
  filterSavedSets,
  proposalRef,
  setRef,
  evidenceRef,
  searchResultRef,
  type SavedSetFilter,
} from "./core/set/store.js";
export {
  buildEvidence,
  summarizeEvidence,
  type EvidenceArtifact,
  type Provenance,
} from "./core/evidence/evidence.js";
export { extractSpecies, type DesignModel } from "./graph/set-designer.js";
