/**
 * doctrine-guard middleware — a second line behind storage permissions (CR-8).
 *
 * Blocks a `save_set` call whose `sourceRef` is not a validated
 * ProposalRef/InferenceRef. The definitive check (that the ref resolves to a
 * staged artifact) lives in the tool body; this guard rejects malformed refs
 * before execution.
 */
import { createMiddleware } from "langchain";
import { ToolMessage } from "@langchain/core/messages";

export function doctrineGuardMiddleware() {
  return createMiddleware({
    name: "doctrine-guard",
    wrapToolCall: (request, handler) => {
      if (request.toolCall.name === "save_set") {
        const args = request.toolCall.args as { sourceRef?: unknown } | undefined;
        const ref = args?.sourceRef;
        if (typeof ref !== "string" || !/^(proposal|inference):/.test(ref)) {
          return new ToolMessage({
            content:
              "Blocked by doctrine-guard: save_set requires a validated sourceRef " +
              "(a ProposalRef like 'proposal:<hash>' or an InferenceRef). It never persists " +
              "model-re-emitted JSON. Stage a set with stage_set first.",
            tool_call_id: request.toolCall.id ?? "",
            name: "save_set",
          });
        }
      }
      return handler(request);
    },
  });
}
