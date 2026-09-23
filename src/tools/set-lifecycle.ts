/**
 * Set lifecycle tools (MVP Phases 2-3): stage_set, save_set, search_saved_sets.
 *
 * Staging is free and thread-scoped; saving is approval-gated (interruptOn) and
 * persists only a validated ProposalRef — never model-re-emitted JSON (CR-8).
 */
import { tool } from "langchain";
import { z } from "zod";
import { stageSet } from "../core/set/stage.js";
import { SetDraftSchema, type ProposalArtifact } from "../core/set/model.js";
import {
  proposalRef,
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
      parentRef?: string;
      evidenceRefs?: string[];
    },
    runtime,
  ) => {
    const result = await stageSet(args.draft, { regulation: args.regulation });

    if (!result.legal) {
      return JSON.stringify({
        legal: false,
        warnings: result.warnings,
        errors: result.errors,
        canonicalSet: result.canonicalSet,
      });
    }

    const artifact: ProposalArtifact = {
      id: proposalRef(result.setHash),
      canonicalSet: result.canonicalSet,
      basis: "proposed",
      origin: { type: "agent" },
      rationale: args.draft.rationale,
      evidenceRefs: args.evidenceRefs ?? [],
      parentRef: args.parentRef,
      validation: {
        legal: true,
        warnings: result.warnings,
        errors: result.errors,
        regulation: result.regulation,
      },
      hash: result.setHash,
      createdAt: new Date().toISOString(),
    };

    const store = getStore(runtime);
    if (store) await writeProposal(store, getThreadId(runtime), artifact);

    return JSON.stringify({
      legal: true,
      proposalRef: artifact.id,
      setHash: result.setHash,
      warnings: result.warnings,
      canonicalSet: result.canonicalSet,
    });
  },
  {
    name: "stage_set",
    description:
      "Validate and stage a proposed set into a canonical ProposalArtifact. Canonicalizes species/form/item/ability/nature/moves, verifies learnset + ability + spread + regulation, and computes the canonical hash. Staging is free (no approval) and thread-scoped. Use save_set to persist a staged proposal.",
    schema: z.object({
      draft: SetDraftSchema.describe("The proposed set to stage."),
      regulation: z.string().optional().describe("Regulation id; defaults to m-c."),
      parentRef: z.string().optional().describe("Parent proposal/set ref when editing an existing set."),
      evidenceRefs: z.array(z.string()).optional().describe("Benchmark evidence refs backing this proposal."),
    }),
  },
);

export const saveSetTool = tool(
  async (args: { sourceRef: string; tags?: string[] }, runtime) => {
    const store = getStore(runtime);
    if (!store) return JSON.stringify({ error: "No store available to persist a set." });

    const proposal = await readProposal(store, getThreadId(runtime), args.sourceRef);
    if (!proposal) {
      return JSON.stringify({
        error: `No staged proposal found for sourceRef "${args.sourceRef}". save_set persists only a validated ProposalRef, never model-emitted JSON.`,
      });
    }

    const { ref, saved, deduped } = await saveSet(store, getUserId(runtime), proposal, { tags: args.tags });
    return JSON.stringify({ setRef: ref, deduped, savedSet: saved });
  },
  {
    name: "save_set",
    description:
      "Persist a staged proposal (by its ProposalRef) into the user's Set Library. Deduplicates by canonical content hash — saving an identical set returns the existing SetRef. Requires human approval. Pass the sourceRef exactly as stage_set returned it.",
    schema: z.object({
      sourceRef: z.string().describe("The proposalRef from stage_set."),
      tags: z.array(z.string()).optional().describe("User tags for retrieval."),
    }),
  },
);

export const searchSavedSetsTool = tool(
  async (
    args: {
      species?: string;
      regulation?: string;
      basis?: "proposed" | "inferred";
      origin?: "agent" | "user";
      tags?: string[];
      intendedAnswers?: string[];
      workflow?: string;
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
      "Query the user's Set Library (durable, user-scoped) by species, regulation, basis, origin, or tags. Independent of the measured meta.",
    schema: z.object({
      species: z.string().optional(),
      regulation: z.string().optional(),
      basis: z.enum(["proposed", "inferred"]).optional(),
      origin: z.enum(["agent", "user"]).optional(),
      tags: z.array(z.string()).optional(),
      intendedAnswers: z.array(z.string()).optional(),
      workflow: z.string().optional(),
    }),
  },
);
