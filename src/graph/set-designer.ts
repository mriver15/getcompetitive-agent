/**
 * Set Designer graph (MVP Phase 4 core).
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
  type ProposalArtifact,
} from "../core/set/model.js";
import { stageSet } from "../core/set/stage.js";
import { resolveEntity } from "../core/dex/resolver.js";
import { proposalRef, writeProposal } from "../core/set/store.js";
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
  proposalRef: Annotation<string>(lastValue("")),
  evidenceRefs: Annotation<string[]>(lastValue<string[]>([])),
  repairCount: Annotation<number>(lastValue(0)),
});

type DesignerStateT = typeof DesignerState.State;

/** Extract a species name from a free-text goal ("build a bulky Annihilape..."). */
export function extractSpecies(text: string, regulation: string): string {
  const direct = resolveEntity(text, GEN);
  if (direct.status === "resolved") return direct.resolved!.name;

  const words = text.split(/[^A-Za-z'\-]+/).filter((w) => w.length > 2);
  const phrases: string[] = [];
  for (let i = 0; i < words.length; i++) {
    phrases.push(words[i]);
    if (i + 1 < words.length) phrases.push(`${words[i]} ${words[i + 1]}`);
  }
  for (const p of phrases) {
    const r = resolveEntity(p, GEN);
    if (r.status === "resolved") return r.resolved!.name;
  }
  return "";
}

async function resolveNode(state: DesignerStateT): Promise<Partial<DesignerStateT>> {
  const last = state.messages.at(-1);
  const text = last ? textOf(last) : "";
  const species = state.species || (text ? extractSpecies(text, state.regulation) : "");
  const goal = state.goal || text;
  return { species, goal };
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
        legal: false,
        warnings: [],
        errors: ["No draft produced by the designer."],
        setHash: "",
        canonicalSet: { species: state.species, moves: [], level: 50 },
        regulation: state.regulation,
      },
      repairCount: state.repairCount + 1,
    };
  }
  const result = await stageSet(state.draft, { regulation: state.regulation });
  return { stageResult: result, repairCount: result.legal ? state.repairCount : state.repairCount + 1 };
}

async function benchmarkNode(state: DesignerStateT): Promise<Partial<DesignerStateT>> {
  const canonical = state.stageResult!.canonicalSet;
  const dex = getDex(GEN);
  const sp = dex.species.get(canonical.forme ?? canonical.species);
  const evs = resolveEvs(canonical.evs, undefined);
  const ivs: Record<string, number> = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
  const stats = statTable(GEN, sp.baseStats, canonical.level, ivs, evs, canonical.nature);
  const result = { species: sp.name, level: canonical.level, nature: canonical.nature, speed: stats.spe, stats };

  const artifact = buildEvidence("ENGINE", "speed", { species: sp.name, level: canonical.level, nature: canonical.nature, evs }, result);
  const store = getStore();
  if (store) await writeEvidence(store, currentThreadId(), artifact);
  return { evidenceRefs: [artifact.id] };
}

async function finalizeNode(state: DesignerStateT): Promise<Partial<DesignerStateT>> {
  if (!state.species) {
    return {
      messages: [new AIMessage("Could not resolve a species from the request; nothing staged.")],
    };
  }
  if (!state.stageResult || !state.stageResult.legal) {
    const errors = state.stageResult?.errors ?? ["no staged set"];
    return {
      messages: [new AIMessage(`Could not produce a legal set after ${state.repairCount} attempt(s). Errors: ${errors.join("; ")}`)],
    };
  }
  const result = state.stageResult;
  const artifact: ProposalArtifact = {
    id: proposalRef(result.setHash),
    canonicalSet: result.canonicalSet,
    basis: "proposed",
    origin: { type: "agent" },
    rationale: state.draft?.rationale,
    evidenceRefs: state.evidenceRefs,
    validation: { legal: true, warnings: result.warnings, errors: result.errors, regulation: result.regulation },
    hash: result.setHash,
    createdAt: new Date().toISOString(),
  };
  const store = getStore();
  if (store) await writeProposal(store, currentThreadId(), artifact);
  return {
    proposalRef: artifact.id,
    messages: [new AIMessage(`Staged proposal ${artifact.id} (${artifact.canonicalSet.species}, legal in ${result.regulation}).`)],
  };
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
  const design = (state: DesignerStateT) => designNode(state, opts.designModel);

  const graph = new StateGraph(DesignerState)
    .addNode("resolve", resolveNode)
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
