/**
 * Field projection (spec §7) — return only requested fields plus minimal
 * identity. Supports nested paths like "baseStats.spe".
 */
import type { Species, Move, Item, Ability, Nature } from "@pkmn/dex";
import {
  getDex,
  toID,
  speciesToObj,
  moveToObj,
  itemToObj,
  abilityToObj,
  natureToObj,
  learnableMoveIds,
  learnsetToObj,
} from "./dex.js";

const GEN = 9;

function pick(obj: Record<string, unknown>, field: string): unknown {
  const dot = field.indexOf(".");
  if (dot >= 0) {
    const head = field.slice(0, dot);
    const sub = obj[head];
    if (sub && typeof sub === "object") return pick(sub as Record<string, unknown>, field.slice(dot + 1));
    return undefined;
  }
  return obj[field];
}

function project(obj: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = pick(obj, f);
    if (v !== undefined) out[f] = v;
  }
  return out;
}

export async function projectSpecies(sp: Species, fields: string[]): Promise<Record<string, unknown>> {
  const flat = speciesToObj(sp) as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = { name: sp.name, id: sp.id };
  const remaining: string[] = [];
  for (const f of fields) {
    if (f === "moves") {
      const learnable = await learnableMoveIds(getDex(GEN), sp);
      out.moves = [...learnable].map((id) => getDex(GEN).moves.get(id).name).sort();
    } else if (f === "learnset") {
      const ls = await getDex(GEN).learnsets.getByID(toID(sp.name));
      out.learnset = learnsetToObj(ls);
    } else {
      remaining.push(f);
    }
  }
  return { ...out, ...project(flat, remaining) };
}

export function projectMove(m: Move, fields: string[]): Record<string, unknown> {
  const flat = moveToObj(m) as unknown as Record<string, unknown>;
  return { name: m.name, id: m.id, ...project(flat, fields) };
}

export function projectItem(i: Item, fields: string[]): Record<string, unknown> {
  const flat = itemToObj(i) as unknown as Record<string, unknown>;
  return { name: i.name, id: i.id, ...project(flat, fields) };
}

export function projectAbility(a: Ability, fields: string[]): Record<string, unknown> {
  const flat = abilityToObj(a) as unknown as Record<string, unknown>;
  return { name: a.name, id: a.id, ...project(flat, fields) };
}

export function projectNature(n: Nature, fields: string[]): Record<string, unknown> {
  const flat = natureToObj(n) as unknown as Record<string, unknown>;
  return { name: n.name, id: n.id, ...project(flat, fields) };
}
