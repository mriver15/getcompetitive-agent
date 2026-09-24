/**
 * End-to-end MVP smoke test — the deterministic dex query + staged set
 * lifecycle path, plus the Set Designer graph and agent wiring. No LLM or
 * network required.
 *
 * Run: npm run smoke
 */
import { InMemoryStore } from "@langchain/langgraph";
import { HumanMessage } from "@langchain/core/messages";
import type { ToolRunnableConfig } from "@langchain/core/tools";
import { resolveEntityTool, lookupFactTool, searchDexTool, expandResultTool } from "./tools/dex-query.js";
import { stageSetTool, saveSetTool, searchSavedSetsTool } from "./tools/set-lifecycle.js";
import { calculateDamageTool, calculateSpeedTool, readEvidenceTool } from "./tools/evidence.js";
import { webSearchTool } from "./tools/web.js";
import { buildSetDesignerGraph, type DesignModel } from "./graph/set-designer.js";
import { buildChampionsAgent } from "./agent.js";

const store = new InMemoryStore();
const toolConfig = (threadId = "smoke-thread", userId = "smoke-user") =>
  ({
    configurable: { thread_id: threadId, userId },
    store,
    context: { userId },
  }) as unknown as ToolRunnableConfig;

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  if (!ok) {
    failures++;
    console.error(`FAIL  ${label}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
  } else {
    console.log(`ok    ${label}`);
  }
}

const bulkyAnnihilape = {
  species: "Annihilape",
  item: "Leftovers",
  ability: "Defiant",
  nature: "Adamant",
  moves: ["Rage Fist", "Drain Punch", "Protect", "Bulk Up"],
  championsPoints: { hp: 32, atk: 32, spd: 2 },
  role: "bulky offense",
  intendedAnswers: ["Incineroar"],
  rationale: ["Trades into Intimidate users and snowballs Rage Fist."],
};

async function main(): Promise<void> {
  console.log("== Dex query ==");

  // L-1..L-3: resolve_entity
  const resolved = JSON.parse(await resolveEntityTool.invoke({ query: "Annihilape" }, toolConfig()));
  check("resolve_entity resolves Annihilape exactly", resolved.status === "exact" && resolved.canonicalName === "Annihilape", resolved);
  const fuzzy = JSON.parse(await resolveEntityTool.invoke({ query: "Annihliape" }, toolConfig()));
  check("resolve_entity returns candidates only on typo (CR-6)", (fuzzy.status === "fuzzy" || fuzzy.status === "ambiguous") && Array.isArray(fuzzy.candidates) && !fuzzy.canonicalId, fuzzy.status);
  const alias = JSON.parse(await resolveEntityTool.invoke({ query: "ape" }, toolConfig()));
  check("resolve_entity resolves alias", alias.status === "alias" && alias.canonicalName === "Annihilape", alias);
  const cap = JSON.parse(await resolveEntityTool.invoke({ query: "Fidgit" }, toolConfig()));
  check("resolve_entity rejects CAP fakemon", cap.status === "not_found", cap.status);

  // L-4..L-5: lookup_fact with kind/names/fields projection
  const facts = JSON.parse(await lookupFactTool.invoke({ kind: "species", names: ["Annihilape"], fields: ["types", "baseStats.spe"] }, toolConfig()));
  const ap = facts.results?.[0];
  check("lookup_fact projects only requested fields + identity", ap?.name === "Annihilape" && Array.isArray(ap?.types) && typeof ap?.["baseStats.spe"] === "number" && ap?.baseStats === undefined && ap?.abilities === undefined, ap);
  const moves = JSON.parse(await lookupFactTool.invoke({ kind: "move", names: ["Rage Fist"], fields: ["type", "basePower"] }, toolConfig()));
  check("lookup_fact supports non-species kinds", moves.results?.[0]?.name === "Rage Fist" && typeof moves.results?.[0]?.basePower === "number", moves.results?.[0]);
  const statusMoves = JSON.parse(await lookupFactTool.invoke({ kind: "species", names: ["Annihilape"], fields: ["moves"], moveFilters: { categories: ["Status"] } }, toolConfig()));
  const sm = statusMoves.results?.[0]?.moves;
  check("lookup_fact moveFilters narrows moves", Array.isArray(sm) && sm.length > 0 && sm.length < 60 && sm.every((m: { category?: string }) => m.category === "Status"), sm?.length);

  // learnsetSources narrows the learnset to one source bucket.
  const ls = JSON.parse(await lookupFactTool.invoke({ kind: "species", names: ["Annihilape"], fields: ["learnset"], learnsetSources: ["TM"] }, toolConfig()));
  const lsObj = ls.results?.[0]?.learnset;
  check("lookup_fact learnsetSources narrows to a source", lsObj?.movesBySource && Object.keys(lsObj.movesBySource).length === 1 && "TM" in lsObj.movesBySource, Object.keys(lsObj?.movesBySource ?? {}));

  // L-6..L-9: search_dex typed constraints
  const bulky = JSON.parse(await searchDexTool.invoke({ entity: "species", filters: { minBaseStats: { hp: 100, def: 80 }, capabilitiesAny: ["priority"] }, regulation: "m-b", fields: ["types"] }, toolConfig()));
  check("search_dex intersects stat + capability + regulation", typeof bulky.total === "number" && Array.isArray(bulky.preview), bulky.total);

  // L-10: capability/learns filters reach Annihilape
  const setup = JSON.parse(await searchDexTool.invoke({ entity: "species", filters: { learnsAll: ["Rage Fist"] }, regulation: "m-b" }, toolConfig()));
  const hasApe = Array.isArray(setup.preview) && setup.preview.some((r: { name: string }) => r.name === "Annihilape");
  check("search_dex learnsAll filter reaches Annihilape", hasApe, setup.total);

  // learnsMove: species that learn at least one move matching type/power criteria.
  const wm = JSON.parse(await searchDexTool.invoke({ entity: "species", filters: { learnsMove: { types: ["Water"], minBasePower: 60 }, legalOnly: true } }, toolConfig()));
  check("search_dex learnsMove filter returns species", typeof wm.total === "number" && wm.total > 0, wm.total);

  // L-8 / CR-7: large results return a preview + resultRef, paged via expand_result.
  const all = JSON.parse(await searchDexTool.invoke({ entity: "species", limit: 5, sort: { field: "num", direction: "asc" } }, toolConfig()));
  check("search_dex returns resultRef for large results", typeof all.total === "number" && all.total > 5 && !!all.resultRef?.startsWith("search:"), all.total);

  // Champions roster only: no CAP, no non-roster species.
  const roster = JSON.parse(await searchDexTool.invoke({ entity: "species", limit: 100 }, toolConfig()));
  const rosterTotal = roster.total as number;
  const hasCap = Array.isArray(roster.preview) && roster.preview.some((r: { num?: number; name?: string }) => (r.num ?? 0) < 1);
  check("search_dex universe is Champions roster only (no CAP)", rosterTotal < 300 && rosterTotal > 100 && !hasCap, rosterTotal);
  if (all.resultRef) {
    const page = JSON.parse(await expandResultTool.invoke({ resultRef: all.resultRef, offset: 0, limit: 3 }, toolConfig()));
    check("expand_result pages a stored result", Array.isArray(page.rows) && page.rows.length === 3, page.rows?.length);
  }

  console.log("== Set lifecycle ==");

  // S-1..S-4: stage_set
  const staged = JSON.parse(await stageSetTool.invoke({ draft: bulkyAnnihilape, regulation: "m-b", goal: "bulky Annihilape for this team" }, toolConfig()));
  check("stage_set validates a legal bulky Annihilape", staged.ok === true && staged.proposalRef?.startsWith("proposal:"), staged);

  // Illegal draft (bad ability + move not in learnset) must be rejected.
  const illegal = JSON.parse(
    await stageSetTool.invoke(
      { draft: { ...bulkyAnnihilape, ability: "Levitate", moves: ["Hydro Pump"] }, regulation: "m-b" },
      toolConfig(),
    ),
  );
  check("stage_set rejects illegal ability + move", illegal.ok === false && illegal.errors.length >= 2, illegal.errors);

  // S-7..S-9: save_set + dedup
  const saved1 = await saveSetTool.invoke({ sourceRef: staged.proposalRef }, toolConfig());
  check("save_set persists by ProposalRef (CR-8)", typeof saved1 === "string" && saved1.includes("set:"), saved1);
  const saved2 = await saveSetTool.invoke({ sourceRef: staged.proposalRef }, toolConfig());
  check("save_set dedups identical save (S-9)", typeof saved2 === "string" && saved2.includes("Already saved"), saved2);

  // CR-8: save_set refuses a non-proposal sourceRef.
  const refused = await saveSetTool.invoke({ sourceRef: "set:deadbeef" }, toolConfig());
  check("save_set refuses a non-staged sourceRef", typeof refused === "string" && refused.includes("No staged proposal"), refused);

  // S-12: search_saved_sets (array filters)
  const found = JSON.parse(await searchSavedSetsTool.invoke({ species: ["Annihilape"], basis: ["proposed"] }, toolConfig()));
  check("search_saved_sets finds the saved set", found.count === 1 && found.sets?.[0]?.species === "Annihilape", found.count);

  console.log("== Evidence / benchmarks ==");

  // S-5 / CR-3: benchmark emits ENGINE evidence
  const dmg = await calculateDamageTool.invoke(
    {
      attacker: { species: "Annihilape", level: 50, nature: "Adamant", evs: { atk: 252 }, ability: "Defiant" },
      defender: { species: "Incineroar", level: 50, nature: "Careful", evs: { hp: 252, spd: 252 } },
      move: "Drain Punch",
    },
    toolConfig(),
  );
  check("calculate_damage returns a readable result + evidence ref", typeof dmg === "string" && dmg.includes("damage") && dmg.includes("evidence:"), dmg);

  const spd = JSON.parse(await calculateSpeedTool.invoke({ species: "Annihilape", nature: "Adamant", championsPoints: { hp: 32, atk: 32, spe: 2 } }, toolConfig()));
  check("calculate_speed returns final speed + evidence", typeof spd.result?.speed === "number" && !!spd.evidenceRef, spd.result?.speed);

  const evRead = JSON.parse(await readEvidenceTool.invoke({ evidenceRef: spd.evidenceRef }, toolConfig()));
  check("read_evidence returns compact summary", evRead.operation === "calculate_speed" && evRead.result !== undefined, evRead.operation);

  // WEB fallback: without TAVILY_API_KEY the tool degrades to a clear error.
  const web = JSON.parse(await webSearchTool.invoke({ query: "Annihilape usage stats" }, toolConfig()));
  check("web_search degrades gracefully without TAVILY_API_KEY", web.provenance === "WEB" && typeof web.error === "string", web.error);

  console.log("== Set Designer graph (Phase 4) ==");

  const fakeDesignModel: DesignModel = {
    invoke: async () => bulkyAnnihilape,
  };
  const graph = buildSetDesignerGraph({ designModel: fakeDesignModel, regulation: "m-b" });
  const gres = await graph.invoke(
    { messages: [new HumanMessage("Build me a bulky Annihilape for this team")] },
    { configurable: { thread_id: "graph-thread" }, store } as never,
  );
  check("designer graph stages a ProposalRef", !!gres.proposalRef?.startsWith("proposal:"), gres.proposalRef);
  check("designer graph produced evidence refs", Array.isArray(gres.evidenceRefs) && gres.evidenceRefs.length === 1, gres.evidenceRefs);
  const gcontent = gres.messages?.at(-1)?.content;
  const gmsg = typeof gcontent === "string" ? gcontent : "";
  check("designer graph message includes set + evidence", gmsg.includes("Annihilape") && gmsg.includes("Leftovers") && gmsg.includes("Rage Fist") && gmsg.includes("Evidence refs"), gmsg);
  const proposalInStore = await store.get(["proposals", "graph-thread"], gres.proposalRef);
  check("designer graph wrote the proposal artifact to the store", !!proposalInStore, proposalInStore?.key);

  // Repair loop: a first draft that is illegal, then a legal one.
  let attempt = 0;
  const flakyModel: DesignModel = {
    invoke: async () => {
      attempt++;
      return attempt === 1
        ? { ...bulkyAnnihilape, ability: "Levitate", moves: ["Hydro Pump"] }
        : bulkyAnnihilape;
    },
  };
  const graph2 = buildSetDesignerGraph({ designModel: flakyModel, regulation: "m-b" });
  const gres2 = await graph2.invoke(
    { messages: [new HumanMessage("Build a bulky Annihilape")] },
    { configurable: { thread_id: "graph-thread-2" }, store } as never,
  );
  check("designer graph repairs an illegal draft", !!gres2.proposalRef?.startsWith("proposal:"), gres2.proposalRef);

  console.log("== Agent wiring ==");
  try {
    const agent = await buildChampionsAgent({ model: "openai:gpt-5.5", designModel: fakeDesignModel, store });
    check("buildChampionsAgent constructs the harness", typeof agent?.invoke === "function", undefined);
  } catch (e) {
    check("buildChampionsAgent constructs the harness", false, (e as Error).message);
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Smoke test crashed:", e);
  process.exit(1);
});
