/**
 * Runtime context + supervisor state (spec §31).
 *
 * Context is per-run, immutable, and namespaces the durable Set Library (user
 * id). State stores references only — never large payloads, which live in the
 * artifact store.
 */
import { StateSchema } from "@langchain/langgraph";
import { z } from "zod";

export const contextSchema = z.object({
  userId: z.string().describe("The calling user's identity; namespaces the durable Set Library."),
  regulation: z.string().optional().describe("Default regulation id for this run (m-a..m-c)."),
});

export const championsStateSchema = new StateSchema({
  activeRegulation: z.string().optional().describe("Regulation resolved once per run."),
  activeTeamRef: z.string().optional().describe("Reference to the active team artifact."),
  activeOpponentRef: z.string().optional().describe("Reference to the active opponent team artifact."),
  activeSearchRef: z.string().optional().describe("Reference to the active large search artifact."),
  activeDossierRef: z.string().optional().describe("Reference to the active matchup dossier artifact."),
  pendingProposalRef: z.string().optional().describe("The proposal awaiting the user's save decision."),
  activeSetRef: z.string().optional().describe("The most recently saved SetRef."),
  evidenceIndex: z.record(z.string(), z.string()).optional().describe("Evidence refs by operation."),
});
