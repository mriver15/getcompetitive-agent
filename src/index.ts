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

export { webSearchTool, THREAT_SOURCES, type ThreatSource } from "./tools/web.js";

export {
  resolveEntity,
  type ResolutionResult,
  type ResolutionCandidate,
  type ResolutionStatus,
  type EntityType,
} from "./core/dex/resolver.js";
export { getDexIndexes, DATASET_VERSION, REGULATION_VERSION, intersectSpecies } from "./core/dex/indexes.js";
export {
  MOVE_CAPABILITIES,
  ABILITY_CAPABILITIES,
  buildCapabilityIndex,
  type CapabilityIndex,
} from "./core/dex/taxonomy.js";
export {
  projectSpecies,
  projectMove,
  projectItem,
  projectAbility,
  projectNature,
} from "./core/dex/projections.js";
export { REGULATION_SETS, getRegulationSet, type RegulationSet } from "./core/dex/regulations.js";
export { stageSet, type StageOptions, type StageOutcome } from "./core/set/stage.js";
export {
  canonicalHash,
  sha256,
  SetDraftSchema as SetDraftZodSchema,
  type SetDraft,
  type CanonicalSet,
  type SetSummary,
  type StageSetResult,
  type ProposalArtifact,
  type SavedSet,
  type ProposalRef,
  type SetRef,
  type EvidenceRef,
  type SearchResultRef,
  type InferenceRef,
  type RegulationId,
  type CapabilityTag,
} from "./core/set/model.js";
export {
  buildProposalArtifact,
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
