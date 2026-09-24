/**
 * Evidence + benchmark tools (spec §20, §33): calculate_damage,
 * calculate_speed, optimize_spread, read_evidence. Every benchmark emits a
 * content-addressed EvidenceArtifact (provenance ENGINE) and returns an
 * EvidenceRef; read_evidence returns a compact summary, never the raw input.
 */
import { tool } from "langchain";
import { z } from "zod";
import {
  getDex,
  damageResult,
  statTable,
  resolveEvs,
  CHAMPIONS_POINTS_MAX,
  type StatID,
  type SetInput,
  STATS,
} from "../core/dex/dex.js";
import { resolveEntity } from "../core/dex/resolver.js";
import { buildEvidence, writeEvidence, readEvidenceArtifact, summarizeEvidence } from "../core/evidence/evidence.js";
import { getThreadId, getStore } from "./runtime.js";

const GEN = 9;

export const calculateDamageTool = tool(
  async (
    args: {
      attacker: Record<string, unknown>;
      defender: Record<string, unknown>;
      move: string;
      field?: Record<string, unknown>;
    },
    runtime,
  ) => {
    try {
      const result = damageResult(GEN, args.attacker as unknown as SetInput, args.defender as unknown as SetInput, args.move, args.field as never);
      const evidence = buildEvidence("ENGINE", "calculate_damage", { attacker: args.attacker, defender: args.defender, move: args.move }, result);
      const store = getStore(runtime);
      if (store) await writeEvidence(store, getThreadId(runtime), evidence);
      const ko = result.koChance ? ` (${result.koChance})` : "";
      return `${result.move} vs ${result.defender.species}: ${result.damageRange[0]}-${result.damageRange[1]} damage${ko}. Evidence: ${evidence.id}`;
    } catch (e) {
      return JSON.stringify({ error: (e as Error).message });
    }
  },
  {
    name: "calculate_damage",
    description:
      "Run a full battle damage calculation (weather/terrain/boosts/items) via the Smogon engine and file it as ENGINE evidence. Use to prove a KO or survival claim. Returns an evidenceRef.",
    schema: z.object({
      attacker: z.record(z.string(), z.unknown()).describe("Attacker set: species, level, nature, evs/championsPoints, item, ability."),
      defender: z.record(z.string(), z.unknown()).describe("Defender set."),
      move: z.string().describe("Move name."),
      field: z.record(z.string(), z.unknown()).optional().describe("Field: gameType, weather, terrain."),
    }),
  },
);

export const calculateSpeedTool = tool(
  async (
    args: {
      species: string;
      nature?: string;
      evs?: Record<string, number>;
      championsPoints?: Record<string, number>;
      level?: number;
    },
    runtime,
  ) => {
    try {
      const dex = getDex(GEN);
      const res = resolveEntity(args.species, { gen: GEN });
      if (!res.canonicalName) {
        return JSON.stringify({ error: `Unresolved species "${args.species}" (${res.status}).` });
      }
      const sp = dex.species.get(res.canonicalName);
      const level = args.level ?? 50;
      const evs = resolveEvs(args.evs, args.championsPoints);
      const ivs: Record<string, number> = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
      const stats = statTable(GEN, sp.baseStats, level, ivs, evs, args.nature);
      const result = { species: sp.name, level, nature: args.nature ?? "Serious", speed: stats.spe, stats };
      const evidence = buildEvidence("ENGINE", "calculate_speed", { species: sp.name, level, nature: args.nature, evs }, result);
      const store = getStore(runtime);
      if (store) await writeEvidence(store, getThreadId(runtime), evidence);
      return JSON.stringify({ ...summarizeEvidence(evidence) });
    } catch (e) {
      return JSON.stringify({ error: (e as Error).message });
    }
  },
  {
    name: "calculate_speed",
    description:
      "Compute the final Speed (and full stat table) at a level with nature/EVs/Champions points, and file it as ENGINE evidence. Use to prove an outspeed claim.",
    schema: z.object({
      species: z.string().describe("Species name."),
      nature: z.string().optional(),
      evs: z.record(z.string(), z.number()).optional(),
      championsPoints: z.record(z.string(), z.number()).optional(),
      level: z.number().int().min(1).max(100).optional(),
    }),
  },
);

export const optimizeSpreadTool = tool(
  async (
    args: {
      species: string;
      nature?: string;
      priority: string[];
      level?: number;
    },
    runtime,
  ) => {
    try {
      const dex = getDex(GEN);
      const res = resolveEntity(args.species, { gen: GEN });
      if (!res.canonicalName) {
        return JSON.stringify({ error: `Unresolved species "${args.species}" (${res.status}).` });
      }
      const sp = dex.species.get(res.canonicalName);
      const level = args.level ?? 50;
      const priority = args.priority.length > 0 ? args.priority.map((s) => s.toLowerCase()) : ["spe"];
      const evs: Record<string, number> = {};
      let budget = 508;
      for (const stat of priority) {
        if (budget <= 0) break;
        if (!STATS.includes(stat as StatID)) continue;
        const amount = Math.min(252, budget - (budget % 4));
        evs[stat] = amount;
        budget -= amount;
      }
      const ivs: Record<string, number> = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
      const stats = statTable(GEN, sp.baseStats, level, ivs, evs, args.nature);
      const result = { species: sp.name, level, nature: args.nature ?? "Serious", evs, championsPoints: evsToPoints(evs), stats };
      const evidence = buildEvidence("ENGINE", "optimize_spread", { species: sp.name, priority, level }, result);
      const store = getStore(runtime);
      if (store) await writeEvidence(store, getThreadId(runtime), evidence);
      return JSON.stringify({ ...summarizeEvidence(evidence) });
    } catch (e) {
      return JSON.stringify({ error: (e as Error).message });
    }
  },
  {
    name: "optimize_spread",
    description:
      "Deterministically allocate EVs into the requested stats in priority order and report the resulting stat table as ENGINE evidence.",
    schema: z.object({
      species: z.string().describe("Species name."),
      nature: z.string().optional(),
      priority: z.array(z.string()).describe("Stat names in allocation priority order."),
      level: z.number().int().min(1).max(100).optional(),
    }),
  },
);

function evsToPoints(evs: Record<string, number>): Record<string, number> {
  const points: Record<string, number> = {};
  for (const s of STATS) {
    if (evs[s] > 0) points[s] = Math.min(CHAMPIONS_POINTS_MAX, Math.round(evs[s] / 8));
  }
  return points;
}

export const readEvidenceTool = tool(
  async ({ evidenceRef }: { evidenceRef: string }, runtime) => {
    const store = getStore(runtime);
    if (!store) return JSON.stringify({ error: "No store available." });
    const artifact = await readEvidenceArtifact(store, getThreadId(runtime), evidenceRef);
    if (!artifact) return JSON.stringify({ error: `No evidence found for ref "${evidenceRef}".` });
    return JSON.stringify(summarizeEvidence(artifact));
  },
  {
    name: "read_evidence",
    description:
      "Read the compact summary of a benchmark evidence artifact by its evidenceRef. Returns provenance, operation, and result — never the raw input.",
    schema: z.object({
      evidenceRef: z.string().describe("The evidenceRef from a benchmark tool."),
    }),
  },
);
