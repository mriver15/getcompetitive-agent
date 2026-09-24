/**
 * Assemble the Champions DeepAgent: supervisor + dex query tools + set
 * lifecycle tools + evidence benchmarks + the Set Designer graph, with the
 * doctrine guard, HITL approval on save_set, storage permissions, and the
 * user-namespaced Set Library.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createDeepAgent,
  StateBackend,
  StoreBackend,
  CompositeBackend,
  FilesystemBackend,
  type CompiledSubAgent,
} from "deepagents";
import { InMemoryStore, MemorySaver, type BaseStore, type BaseCheckpointSaver } from "@langchain/langgraph";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { initChatModel } from "langchain";
import { resolveEntityTool, lookupFactTool, searchDexTool, expandResultTool } from "./tools/dex-query.js";
import { stageSetTool, saveSetTool, searchSavedSetsTool } from "./tools/set-lifecycle.js";
import {
  calculateDamageTool,
  calculateSpeedTool,
  optimizeSpreadTool,
  readEvidenceTool,
} from "./tools/evidence.js";
import { doctrineGuardMiddleware } from "./middleware/doctrine-guard.js";
import { contextSchema, championsStateSchema } from "./state.js";
import { SYSTEM_PROMPT } from "./system-prompt.js";
import { buildSetDesignerGraph, type DesignModel } from "./graph/set-designer.js";
import { SetDraftSchema } from "./core/set/model.js";

const skillsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "skills");

export interface BuildChampionsAgentOptions {
  /** Model string (`provider:model`) or chat model instance. */
  model?: string | BaseChatModel;
  /** Structured-output design runnable for the Set Designer. Defaults to `model.withStructuredOutput(SetDraftSchema)`. */
  designModel?: DesignModel;
  /** When true, save_set runs without an approval interrupt. Default false. */
  autoSaveAgentProposals?: boolean;
  checkpointer?: BaseCheckpointSaver;
  store?: BaseStore;
}

export async function buildChampionsAgent(opts: BuildChampionsAgentOptions = {}) {
  // Precedence: explicit `model` -> CHAMPIONS_MODEL -> DeepSeek (if a key is
  // present) -> OpenAI. `deepseek:deepseek-chat` uses @langchain/deepseek,
  // which reads DEEPSEEK_API_KEY.
  const model =
    opts.model ??
    process.env.CHAMPIONS_MODEL ??
    (process.env.DEEPSEEK_API_KEY ? "deepseek:deepseek-chat" : "openai:gpt-5.5");

  let designModel: DesignModel;
  if (opts.designModel) {
    designModel = opts.designModel;
  } else if (typeof model === "string") {
    designModel = (await initChatModel(model)).withStructuredOutput(SetDraftSchema);
  } else {
    designModel = model.withStructuredOutput(SetDraftSchema);
  }

  const setDesigner: CompiledSubAgent = {
    name: "set-designer",
    description:
      "Designs a single competitive Pokémon Champions set from a goal and a species: searches dex candidates, drafts a typed SetDraft, validates it (learnset/ability/spread/regulation), benchmarks it, and returns a staged ProposalRef with evidence. Use when the user asks to build or design a set, e.g. 'build me a bulky Annihilape for this team'.",
    runnable: buildSetDesignerGraph({ designModel }),
  };

  const store = opts.store ?? new InMemoryStore();
  const checkpointer = opts.checkpointer ?? new MemorySaver();

  return createDeepAgent({
    model,
    systemPrompt: SYSTEM_PROMPT,
    tools: [
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
    ],
    subagents: [setDesigner],
    middleware: [doctrineGuardMiddleware()],
    stateSchema: championsStateSchema,
    contextSchema,
    backend: new CompositeBackend(new StateBackend(), {
      "/sets/": new StoreBackend({ namespace: ["sets"] }),
      "/skills/": new FilesystemBackend({ rootDir: skillsDir, virtualMode: true }),
    }),
    skills: ["/skills/"],
    permissions: [
      // CR-8: the generic write_file/edit_file tools cannot touch the library.
      { operations: ["write"], paths: ["/sets/**"], mode: "deny" },
    ],
    interruptOn: opts.autoSaveAgentProposals
      ? {}
      : { save_set: { allowedDecisions: ["approve", "reject"] } },
    checkpointer,
    store,
  });
}

export {
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
};
