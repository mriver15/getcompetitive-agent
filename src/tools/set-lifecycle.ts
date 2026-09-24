/**
 * Set lifecycle tools (spec §17, §22, §29): stage_set, save_set,
 * search_saved_sets.
 *
 * Staging is free and thread-scoped; saving is approval-gated (interruptOn)
 * and persists only a validated ProposalRef — never model-re-emitted JSON
 * (CR-8).
 */
import { tool } from "langchain";
import { z } from "zod";
import { stageSet } from "../core/set/stage.js";
import { SetDraftSchema, type ProposalArtifact } from "../core/set/model.js";
import {
  buildProposalArtifact,
  writeProposal,
  readProposal,
  saveSet,
  listSavedSets,
  filterSavedSets,
} from "../core/set/store.js";
import { getThreadId, getUserId, getStore } from "./runtime.js";

export const stageSetTool = tool(
  async (
    args: {
      draft: z.infer<typeof SetDraftSchema>;
      regulation?: string;
      goal?: string;
      evidenceRefs?: string[];
      parentSetRef?: string;
    },
    runtime,
  ) => {
    const outcome = await stageSet(args.draft, {
      regulation: args.regulation,
      goal: args.goal,
      evidenceRefs: args.evidenceRefs,
      parentSetRef: args.parentSetRef,
    });

    if (!outcome.result.ok) {
      return JSON.stringify(outcome.result);
    }

    const artifact: ProposalArtifact = buildProposalArtifact(outcome.result, outcome.canonicalSet, args.draft, {
      regulation: args.regulation,
      goal: args.goal,
      parentSetRef: args.parentSetRef,
      workflow: "set-designer",
    });

    const store = getStore(runtime);
    if (store) await writeProposal(store, getThreadId(runtime), artifact);

    return JSON.stringify(outcome.result);
  },
  {
    name: "stage_set",
    description:
      "Validate and stage a proposed SetDraft into a canonical ProposalArtifact. Canonicalizes species/form/item/ability/nature/moves, verifies learnset + ability + spread + regulation, and computes the canonical hash. Staging is free (no approval) and thread-scoped. Returns a ProposalRef plus warnings/errors/legal; use save_set to persist it.",
    schema: z.object({
      draft: SetDraftSchema.describe("The proposed set to stage."),
      regulation: z.string().optional().describe("Regulation id; defaults to m-c."),
      goal: z.string().optional().describe("The design goal this proposal serves."),
      evidenceRefs: z.array(z.string()).optional().describe("Benchmark evidence refs backing this proposal."),
      parentSetRef: z.string().optional().describe("Parent proposal/set ref when editing an existing set."),
    }),
  },
);

export const saveSetTool = tool(
  async (args: { sourceRef: string; label?: string; tags?: string[] }, runtime) => {
    const store = getStore(runtime);
    if (!store) return JSON.stringify({ error: "No store available to persist a set." });

    const proposal = await readProposal(store, getThreadId(runtime), args.sourceRef);
    if (!proposal) {
      return JSON.stringify({
        error: `No staged proposal found for sourceRef "${args.sourceRef}". save_set persists only a validated ProposalRef, never model-emitted JSON.`,
      });
    }

    const { ref, saved, deduped } = await saveSet(store, getUserId(runtime), proposal, {
      label: args.label,
      tags: args.tags,
    });
    return JSON.stringify({ setRef: ref, deduped, savedSet: saved });
  },
  {
    name: "save_set",
    description:
      "Persist a staged proposal (by its ProposalRef) into the user's Set Library. Deduplicates by canonical content hash — saving an identical set returns the existing SetRef. Requires human approval. Pass the sourceRef exactly as stage_set returned it.",
    schema: z.object({
      sourceRef: z.string().describe("The proposalRef from stage_set."),
      label: z.string().optional().describe("Display label for the saved set."),
      tags: z.array(z.string()).optional().describe("User tags for retrieval."),
    }),
  },
);

export const searchSavedSetsTool = tool(
  async (
    args: {
      species?: string[];
      regulation?: string;
      basis?: Array<"proposed" | "inferred">;
      origin?: Array<"agent" | "user" | "battle">;
      tagsAny?: string[];
      intendedAnswers?: string[];
      workflow?: string;
      limit?: number;
    },
    runtime,
  ) => {
    const store = getStore(runtime);
    if (!store) return JSON.stringify({ count: 0, sets: [] });
    const sets = await listSavedSets(store, getUserId(runtime));
    const filtered = filterSavedSets(sets, args);
    return JSON.stringify({ count: filtered.length, sets: filtered });
  },
  {
    name: "search_saved_sets",
    description:
      "Query the user's Set Library (durable, user-scoped) by species, regulation, basis, origin, tags, intended answers, or workflow. Independent of the measured meta.",
    schema: z.object({
      species: z.array(z.string()).optional(),
      regulation: z.string().optional(),
      basis: z.array(z.enum(["proposed", "inferred"])).optional(),
      origin: z.array(z.enum(["agent", "user", "battle"])).optional(),
      tagsAny: z.array(z.string()).optional(),
      intendedAnswers: z.array(z.string()).optional(),
      workflow: z.string().optional(),
      limit: z.number().int().min(1).optional(),
    }),
  },
);
