/**
 * Set Designer graph (spec §18, MVP Phase 4 core).
 *
 * A LangGraph StateGraph — resolve/search (deterministic) -> design (bounded,
 * responseFormat SetDraft) -> stage (validation) -> conditional repair edge ->
 * benchmark (deterministic evidence) -> ProposalRef — wrapped as a
 * CompiledSubAgent so the supervisor invokes it via `task`.
 *
 * The model node only ever emits a typed SetDraft; it cannot save or write.
 * Staging and benchmarking are deterministic nodes.
 */
import { Annotation, StateGraph, START, END, messagesStateReducer, getStore, getConfig } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import {
  type SetDraft,
  type StageSetResult,
  type CanonicalSet,
  type ProposalArtifact,
} from "../core/set/model.js";
import { stageSet } from "../core/set/stage.js";
import { resolveEntity } from "../core/dex/resolver.js";
import { buildProposalArtifact, writeProposal } from "../core/set/store.js";
import { buildEvidence, writeEvidence } from "../core/evidence/evidence.js";
import { getDex, statTable, resolveEvs } from "../core/dex/dex.js";

const GEN = 9;
const MAX_REPAIRS = 3;

/** A structured-output runnable that returns a typed SetDraft from messages. */
export type DesignModel = { invoke(messages: BaseMessage[]): Promise<SetDraft> };

/** Last-value-wins channel with a default (Annotation needs an explicit reducer for a default). */
function lastValue<T>(defaultValue: T): { reducer: (_prev: T, next: T) => T; default: () => T } {
  return { reducer: (_prev, next) => next, default: () => defaultValue };
}

const DesignerState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  goal: Annotation<string>(lastValue("")),
  species: Annotation<string>(lastValue("")),
  regulation: Annotation<string>(lastValue("m-c")),
  draft: Annotation<SetDraft | undefined>(lastValue<SetDraft | undefined>(undefined)),
  stageResult: Annotation<StageSetResult | undefined>(lastValue<StageSetResult | undefined>(undefined)),
  canonicalSet: Annotation<CanonicalSet | undefined>(lastValue<CanonicalSet | undefined>(undefined)),
  benchmarkResult: Annotation<Record<string, unknown> | undefined>(lastValue<Record<string, unknown> | undefined>(undefined)),
  proposalRef: Annotation<string>(lastValue("")),
  evidenceRefs: Annotation<string[]>(lastValue<string[]>([])),
  repairCount: Annotation<number>(lastValue(0)),
});

type DesignerStateT = typeof DesignerState.State;

/** Extract a species name from a free-text goal ("build a bulky Annihilape..."). */
export function extractSpecies(text: string): string {
  const direct = resolveEntity(text, { gen: GEN });
  if (direct.canonicalName) return direct.canonicalName;

  const words = text.split(/[^A-Za-z'\-]+/).filter((w) => w.length > 2);
  const phrases: string[] = [];
  for (let i = 0; i < words.length; i++) {
    phrases.push(words[i]);
    if (i + 1 < words.length) phrases.push(`${words[i]} ${words[i + 1]}`);
  }
  for (const p of phrases) {
    const r = resolveEntity(p, { gen: GEN });
    if (r.canonicalName) return r.canonicalName;
  }
  return "";
}

async function resolveNode(state: DesignerStateT, defaultRegulation: string): Promise<Partial<DesignerStateT>> {
  const last = state.messages.at(-1);
  const text = last ? textOf(last) : "";
  const species = state.species || (text ? extractSpecies(text) : "");
  const goal = state.goal || text;
  return { species, goal, regulation: state.regulation || defaultRegulation };
}

function textOf(m: BaseMessage): string {
  const c = m.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((b) => (typeof b === "string" ? b : (b as { text?: string }).text ?? "")).join(" ");
  return "";
}

function designPrompt(state: DesignerStateT): string {
  const parts = [
    `Goal: ${state.goal || "design a competitive set"}`,
    `Target species: ${state.species || "(unresolved)"}`,
    `Regulation: ${state.regulation}`,
    "Design a single Pokémon Champions set as a typed SetDraft (species, item, ability, nature, moves, evs or championsPoints, role, rationale).",
  ];
  if (state.stageResult && !state.stageResult.legal) {
    parts.push(`Previous draft was rejected. Fix these errors:\n- ${state.stageResult.errors.join("\n- ")}`);
  }
  return parts.join("\n");
}

async function designNode(state: DesignerStateT, designModel: DesignModel): Promise<Partial<DesignerStateT>> {
  const messages: BaseMessage[] = [
    new SystemMessage(designPrompt(state)),
    new HumanMessage("Return the SetDraft."),
  ];
  const draft = await designModel.invoke(messages);
  return { draft };
}

async function stageNode(state: DesignerStateT): Promise<Partial<DesignerStateT>> {
  if (!state.draft) {
    return {
      stageResult: {
        ok: false,
        legal: false,
        warnings: [],
        errors: ["No draft produced by the designer."],
        evidenceRefs: [],
      },
      repairCount: state.repairCount + 1,
    };
  }
  const outcome = await stageSet(state.draft, { regulation: state.regulation, goal: state.goal });
  return {
    stageResult: outcome.result,
    canonicalSet: outcome.canonicalSet,
    repairCount: outcome.result.legal ? state.repairCount : state.repairCount + 1,
  };
}

async function benchmarkNode(state: DesignerStateT): Promise<Partial<DesignerStateT>> {
  const canonical = state.canonicalSet;
  if (!canonical) return { evidenceRefs: [] };
  const dex = getDex(GEN);
  const sp = dex.species.get(canonical.forme ?? canonical.species);
  const evs = resolveEvs(canonical.evs, undefined);
  const ivs: Record<string, number> = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
  const stats = statTable(GEN, sp.baseStats, canonical.level, ivs, evs, canonical.nature);
  const result = { species: sp.name, level: canonical.level, nature: canonical.nature, speed: stats.spe, stats };

  const artifact = buildEvidence("ENGINE", "calculate_speed", { species: sp.name, level: canonical.level, nature: canonical.nature, evs }, result);
  const store = getStore();
  if (store) await writeEvidence(store, currentThreadId(), artifact);
  return { evidenceRefs: [artifact.id], benchmarkResult: result };
}

async function finalizeNode(state: DesignerStateT): Promise<Partial<DesignerStateT>> {
  if (!state.species) {
    return {
      messages: [new AIMessage("Could not resolve a species from the request; nothing staged.")],
    };
  }
  if (!state.stageResult || !state.stageResult.legal || !state.canonicalSet) {
    const errors = state.stageResult?.errors ?? ["no staged set"];
    return {
      messages: [new AIMessage(`Could not produce a legal set after ${state.repairCount} attempt(s). Errors: ${errors.join("; ")}`)],
    };
  }
  const artifact: ProposalArtifact = buildProposalArtifact(
    state.stageResult,
    state.canonicalSet,
    state.draft ?? { species: state.species, moves: [] },
    { regulation: state.regulation, goal: state.goal, workflow: "set-designer" },
  );
  artifact.evidenceRefs = state.evidenceRefs;
  const store = getStore();
  if (store) await writeProposal(store, currentThreadId(), artifact);
  return {
    proposalRef: artifact.id,
    evidenceRefs: artifact.evidenceRefs,
    messages: [new AIMessage(formatProposal(artifact, state))],
  };
}

/** Render the staged set + benchmark evidence as a supervisor-presentable summary. */
function formatProposal(artifact: ProposalArtifact, state: DesignerStateT): string {
  const s = artifact.canonicalSet;
  const displaySpecies = s.forme ? `${s.species} (${s.forme})` : s.species;
  const lines = [
    `Staged proposal ref: ${artifact.id}`,
    `Regulation: ${state.regulation} (legal: ${artifact.validation.legal})`,
    "",
    "Set:",
    `- Species: ${displaySpecies}`,
    `- Item: ${s.item ?? "none"}`,
    `- Ability: ${s.ability ?? "none"}`,
    `- Nature: ${s.nature ?? "Serious"}`,
    `- Moves: ${s.moves.join(", ") || "none"}`,
    `- EVs: ${formatEvs(s.evs)}`,
    `- Champions points: ${championsPointsFromEvs(s.evs)}`,
    `- Level: ${s.level}`,
  ];
  const b = state.benchmarkResult as { speed?: number; nature?: string; level?: number; stats?: Record<string, number> } | undefined;
  if (b) {
    lines.push("", "Benchmark (ENGINE evidence):", `- Speed: ${b.speed} (L${b.level ?? s.level} ${b.nature ?? "Serious"})`, `- Final stats: ${formatStats(b.stats)}`);
  }
  if (artifact.evidenceRefs.length) {
    lines.push("", `Evidence refs: ${artifact.evidenceRefs.join(", ")}`);
  }
  return lines.join("\n");
}

const STAT_ORDER = ["hp", "atk", "def", "spa", "spd", "spe"];

function formatEvs(evs?: Record<string, number>): string {
  if (!evs) return "none";
  const parts = STAT_ORDER.filter((k) => (evs[k] ?? 0) > 0).map((k) => `${k.toUpperCase()} ${evs[k]}`);
  return parts.join(" / ") || "none";
}

function championsPointsFromEvs(evs?: Record<string, number>): string {
  if (!evs) return "none";
  const parts = STAT_ORDER.filter((k) => (evs[k] ?? 0) > 0).map((k) => `${k.toUpperCase()} ${Math.round(evs[k] / 8)}`);
  return parts.join(" / ") || "none";
}

function formatStats(stats?: Record<string, number>): string {
  if (!stats) return "n/a";
  return STAT_ORDER.map((k) => `${k.toUpperCase()} ${stats[k] ?? 0}`).join(" / ");
}

function currentThreadId(): string {
  const cfg = getConfig();
  return (cfg?.configurable?.thread_id as string | undefined) ?? "default";
}

function routeAfterStage(state: DesignerStateT): "design" | "benchmark" | "finalize" {
  if (!state.stageResult) return "design";
  if (state.stageResult.legal) return "benchmark";
  if (state.repairCount >= MAX_REPAIRS) return "finalize";
  return "design";
}

function routeAfterResolve(state: DesignerStateT): "design" | "finalize" {
  if (!state.species) return "finalize";
  return "design";
}

export function buildSetDesignerGraph(opts: {
  designModel: DesignModel;
  /** Default regulation when the task does not state one. */
  regulation?: string;
}) {
  const regulation = opts.regulation ?? "m-c";
  const design = (state: DesignerStateT) => designNode(state, opts.designModel);
  const resolve = (state: DesignerStateT) => resolveNode(state, regulation);

  const graph = new StateGraph(DesignerState)
    .addNode("resolve", resolve)
    .addNode("design", design)
    .addNode("stage", stageNode)
    .addNode("benchmark", benchmarkNode)
    .addNode("finalize", finalizeNode)
    .addEdge(START, "resolve")
    .addConditionalEdges("resolve", routeAfterResolve, { design: "design", finalize: "finalize" })
    .addEdge("design", "stage")
    .addConditionalEdges("stage", routeAfterStage, { design: "design", benchmark: "benchmark", finalize: "finalize" })
    .addEdge("benchmark", "finalize")
    .addEdge("finalize", END);

  return graph.compile();
}

export type SetDesignerGraph = ReturnType<typeof buildSetDesignerGraph>;
