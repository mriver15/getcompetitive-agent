/**
 * Runtime context + custom state schema.
 *
 * Context is per-run, immutable, and namespaces the durable Set Library (user
 * id). State holds references only; private fields are prefixed `_` and are
 * excluded from the result.
 */
import { StateSchema } from "@langchain/langgraph";
import { z } from "zod";

export const contextSchema = z.object({
  userId: z.string().describe("The calling user's identity; namespaces the durable Set Library."),
  regulation: z.string().optional().describe("Default regulation id for this run (m-a..m-c)."),
});

export const championsStateSchema = new StateSchema({
  regulation: z.string().optional().describe("Regulation resolved once per run."),
  _proposalRefs: z.array(z.string()).optional().describe("Proposal refs staged this run (private)."),
  _evidenceRefs: z.array(z.string()).optional().describe("Evidence refs produced this run (private)."),
});
