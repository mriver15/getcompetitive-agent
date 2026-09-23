/**
 * Shared data + mechanics layer.
 *
 * Data (species/moves/items/abilities/natures/types/learnsets) comes from
 * `@pkmn/dex`, which bundles the full Pokemon Showdown competitive dataset.
 * Battle math (stat calc + damage calc) comes from `@smogon/calc`, which is
 * self-contained and generation-aware.
 */
import { Dex, toID } from '@pkmn/dex';
import type {
  ModdedDex,
  Species,
  Move,
  Item,
  Ability,
  Nature,
  Type as DexType,
  Learnset,
  MoveSource,
} from '@pkmn/dex';
import { Generations, Pokemon, Move as CalcMove, Field, Side, calculate, calcStat } from '@smogon/calc';

export { toID };

export const STATS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const;
export type StatID = (typeof STATS)[number];

/** The 18 types a Champions battle uses; Stellar is outside them. */
export const TYPES18 = [
  'Normal', 'Fighting', 'Flying', 'Poison', 'Ground', 'Rock', 'Bug', 'Ghost', 'Steel',
  'Fire', 'Water', 'Grass', 'Electric', 'Psychic', 'Ice', 'Dragon', 'Dark', 'Fairy',
] as const;

export const NATURES = [
  'Adamant', 'Bashful', 'Bold', 'Brave', 'Calm', 'Careful', 'Docile', 'Gentle', 'Hardy',
  'Hasty', 'Impish', 'Jolly', 'Lax', 'Lonely', 'Mild', 'Modest', 'Naive', 'Naughty',
  'Quiet', 'Quirky', 'Rash', 'Relaxed', 'Sassy', 'Serious', 'Timid',
] as const;

export type GenerationNum = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

const dexCache = new Map<number, ModdedDex>();

/** Generation-scoped view of the Showdown dataset. */
export function getDex(gen: GenerationNum): ModdedDex {
  const cached = dexCache.get(gen);
  if (cached) return cached;
  const d = Dex.forGen(gen);
  dexCache.set(gen, d);
  return d;
}

/** Generation-scoped @smogon/calc generator. */
export function getCalcGen(gen: GenerationNum) {
  return Generations.get(gen);
}

/** Clean, JSON-safe projection of a Species for LLM consumption. */
export function speciesToObj(s: Species) {
  return {
    name: s.name,
    num: s.num,
    types: s.types,
    baseStats: s.baseStats,
    bst: s.bst,
    abilities: s.abilities,
    baseSpecies: s.baseSpecies || undefined,
    forme: s.forme || undefined,
    baseForme: s.baseForme || undefined,
    otherFormes: s.otherFormes,
    cosmeticFormes: s.cosmeticFormes,
    formeOrder: s.formeOrder,
    isCosmeticForme: s.isCosmeticForme,
    battleOnly: s.battleOnly,
    weightkg: s.weightkg,
    genderRatio: s.genderRatio,
    gender: s.gender,
    eggGroups: s.eggGroups,
    nfe: s.nfe,
    canHatch: s.canHatch,
    prevo: s.prevo || undefined,
    evos: s.evos,
    evoLevel: s.evoLevel,
    evoItem: s.evoItem,
    evoMove: s.evoMove,
    evoCondition: s.evoCondition,
    isMega: s.isMega || undefined,
    tags: s.tags,
  };
}

export function moveToObj(m: Move) {
  return {
    name: m.name,
    num: m.num,
    type: m.type,
    category: m.category,
    basePower: m.basePower,
    accuracy: m.accuracy,
    pp: m.pp,
    priority: m.priority,
    target: m.target,
    flags: m.flags as unknown as Record<string, number>,
    shortDesc: m.shortDesc,
    desc: m.desc,
    secondary: m.secondary ?? undefined,
    secondaries: m.secondaries,
    breaksProtect: m.breaksProtect || undefined,
    drain: m.drain,
    recoil: m.recoil,
    multihit: m.multihit,
    alwaysHit: m.alwaysHit || undefined,
  };
}

export function itemToObj(i: Item) {
  return {
    name: i.name,
    num: i.num,
    // Showdown marks an entry it has retired with the game whose rules the text
    // describes ("(Gen 2) …"). Which earlier game a relic came from is not
    // something this server reports, so the marker goes and the effect text —
    // the dataset's own wording for the entry — stands on its own.
    shortDesc: (i.shortDesc ?? '').replace(/^\(Gen [^)]*\)\s*/, ''),
    desc: (i.desc ?? '').replace(/^\(Gen [^)]*\)\s*/, ''),
    isBerry: i.isBerry || undefined,
    isChoice: i.isChoice || undefined,
    isGem: i.isGem || undefined,
    isPokeball: i.isPokeball || undefined,
    megaStone: i.megaStone,
    fling: i.fling,
    boosts: i.boosts || undefined,
    forcedForme: i.forcedForme,
    itemUser: i.itemUser,
  };
}

export function abilityToObj(a: Ability) {
  return {
    name: a.name,
    num: a.num,
    shortDesc: a.shortDesc,
    desc: a.desc,
    flags: a.flags as unknown as Record<string, number>,
  };
}

export function natureToObj(n: Nature) {
  return {
    name: n.name,
    plus: n.plus,
    minus: n.minus,
  };
}

/**
 * Showdown stores `Type.damageTaken[attackingType]` as an index, not a multiplier:
 * 0 = 1x, 1 = 2x, 2 = 0.5x, 3 = 0x (immune).
 */
const DAMAGE_TAKEN_MULT: Record<number, number> = { 0: 1, 1: 2, 2: 0.5, 3: 0 };

/** Offensive multiplier of `attackingType` against a defender with `defendingTypes`. */
export function typeEffectiveness(attackingType: string, defendingTypes: string[], gen: GenerationNum): number {
  const dex = getDex(gen);
  let mult = 1;
  for (const dt of defendingTypes) {
    const t = dex.types.get(dt);
    if (!t.exists) throw new Error(`Unknown type "${dt}".`);
    mult *= DAMAGE_TAKEN_MULT[t.damageTaken[attackingType] ?? 0];
  }
  return mult;
}

/** Convert a raw damageTaken table into human multipliers keyed by attacking type. */
function damageTakenToMultipliers(damageTaken: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [atk, idx] of Object.entries(damageTaken)) {
    out[atk] = DAMAGE_TAKEN_MULT[idx] ?? 1;
  }
  return out;
}

export function typeToObj(t: DexType) {
  const taken = damageTakenToMultipliers(t.damageTaken);
  const weaknesses: string[] = [];
  const resistances: string[] = [];
  const immunities: string[] = [];
  for (const [atk, mult] of Object.entries(taken)) {
    if (mult === 0) immunities.push(atk);
    else if (mult > 1) weaknesses.push(atk);
    else if (mult < 1) resistances.push(atk);
  }
  return {
    name: t.name,
    damageTaken: taken,
    weaknesses,
    resistances,
    immunities,
    HPivs: t.HPivs,
  };
}

/**
 * Every move a species can know: its evolution line plus its base species.
 *
 * The line is the species and each pre-evolution, because egg and level-up
 * moves carry up on evolution while Showdown files them against the species
 * that learns them — Fake Out is Grookey's egg move, not Rillaboom's, yet
 * Rillaboom can hold it.
 *
 * The base species is added for the submitted species only, which is what lets
 * a form draw on the shared pool (Rotom-Wash on Rotom's). It deliberately does
 * NOT extend the line: Johto Sneasel is Hisuian Sneasel's base species, but
 * Surf arrives on Hisuian Sneasel's path to Sneasler by no route.
 */
const learnsetCache = new Map<string, Set<string>>();

export async function learnableMoveIds(dex: ModdedDex, species: Species): Promise<Set<string>> {
  const cacheKey = toID(species.name);
  const cached = learnsetCache.get(cacheKey);
  if (cached) return cached;

  const line: Species[] = [];
  const seen = new Set<string>();
  let current: Species | undefined = species;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    line.push(current);
    // A battle-only form carries no `prevo` of its own (Charizard-Mega-Y), so the
    // first step falls back to its base species and the line runs on from there.
    // A regional form does carry one (Arcanine-Hisui -> Growlithe-Hisui), and
    // stopping there is what keeps Kantonian Growlithe's pool out of it.
    const next: string =
      current.prevo || (current === species && current.baseSpecies !== current.name ? current.baseSpecies : '');
    current = next ? dex.species.get(next) : undefined;
  }

  const ids = new Set<string>();
  for (const link of line) {
    const learnset = await dex.learnsets.getByID(toID(link.name));
    for (const id of Object.keys(learnset.learnset ?? {})) ids.add(id);
  }
  learnsetCache.set(cacheKey, ids);
  return ids;
}

/** Group a learnset's move sources into readable buckets. */
export function learnsetToObj(ls: Learnset) {
  const buckets: Record<string, string[]> = {};
  if (ls.learnset) {
    for (const [moveid, sources] of Object.entries(ls.learnset)) {
      const move = Dex.moves.getByID(moveid as never);
      const name = move.exists ? move.name : moveid;
      const tags = normalizeSources(sources);
      for (const tag of tags) {
        (buckets[tag] ??= []).push(name);
      }
    }
  }
  for (const k of Object.keys(buckets)) buckets[k].sort();
  return {
    exists: ls.exists,
    eventOnly: ls.eventOnly,
    // Which past game ran an event distribution (`generation`, `source`,
    // `emeraldEventEgg`) is provenance into the mainline releases, and the games
    // are not what this server is about: the level, moves and fixed attributes
    // are what a set can use.
    eventData: ls.eventData?.map(({ generation, source, emeraldEventEgg, ...rest }) => rest),
    movesBySource: buckets,
    totalMoves: ls.learnset ? Object.keys(ls.learnset).length : 0,
  };
}

/** Collapse Showdown's terse move-source codes into human-readable method names. */
function normalizeSources(sources: MoveSource[]): string[] {
  const out = new Set<string>();
  for (const s of sources) {
    let m = s.trim();
    // Strip gen availability flags like "8L1" -> "L1"
    m = m.replace(/^\d+/, '');
    if (/^[L]\d+$/.test(m)) out.add('Level-up');
    else if (/^[M]$/.test(m)) out.add('TM');
    else if (/^[E]$/.test(m)) out.add('Egg');
    else if (/^[T]$/.test(m)) out.add('Tutor');
    else if (/^[S]\d*$/.test(m)) out.add('Event');
    else if (/^[R]$/.test(m)) out.add('Raid/Event');
    // Routes that only ever belonged to earlier games' distribution machinery —
    // a transfer up from a re-release, and the Dream World web feature — carry no
    // name a Champions player would recognise, so they are reported plainly.
    else if (/^[V]$/.test(m)) out.add('Transfer');
    else if (/^[D]$/.test(m)) out.add('Other');
    else if (/^[P]$/.test(m)) out.add('Pre-evolution');
    else out.add('Other');
  }
  return [...out];
}

/**
 * Compute a single final stat for a species at a given level with IV/EV/nature.
 * Mirrors the in-game formula (nature applied to non-HP stats).
 */
export function finalStat(
  gen: GenerationNum,
  stat: StatID,
  base: number,
  iv: number,
  ev: number,
  level: number,
  nature?: string,
): number {
  return calcStat(getCalcGen(gen), stat, base, iv, ev, level, nature);
}

/** Pokémon Champions budgets stat points rather than EVs: 66 total, at most 32 in one stat. */
export const CHAMPIONS_POINTS_TOTAL = 66;
export const CHAMPIONS_POINTS_MAX = 32;
/** One point is worth 8 EVs — the rate that lands 32 points on the 252-EV cap. */
const EV_PER_CHAMPIONS_POINT = 8;

/**
 * Convert a Champions stat-point spread (0-32 per stat, 66 points total) into the
 * 0-252 EVs `@smogon/calc` takes.
 *
 * The two systems budget differently — 66 points is 528 EVs at this rate, against
 * the 510 cap the calc enforces — so a converted spread is trimmed from its largest
 * stats, in steps of 4, until it fits. `scripts/build-threats.mjs` applies the same
 * rule to the published spreads; keep the two in step.
 */
export function championsPointsToEvs(points: Record<string, number>): Record<string, number> {
  let total = 0;
  const evs: Record<string, number> = {};
  for (const s of STATS) {
    const p = points[s] ?? 0;
    if (!Number.isInteger(p) || p < 0 || p > CHAMPIONS_POINTS_MAX) {
      throw new Error(`Champions points for "${s}" must be a whole number 0-${CHAMPIONS_POINTS_MAX}; you sent ${p}.`);
    }
    total += p;
    if (p > 0) evs[s] = Math.min(252, p * EV_PER_CHAMPIONS_POINT);
  }
  if (total > CHAMPIONS_POINTS_TOTAL) {
    const breakdown = STATS.filter((s) => (points[s] ?? 0) > 0)
      .map((s) => `${points[s]} ${s}`)
      .join(' + ');
    throw new Error(
      `Champions spread totals ${total} CP; budget is ${CHAMPIONS_POINTS_TOTAL}. You sent ${breakdown || 'nothing'} = ${total}; drop to ${CHAMPIONS_POINTS_TOTAL} or less, e.g. 32/32/1 = 65.`,
    );
  }

  let sum = STATS.reduce((acc, s) => acc + (evs[s] ?? 0), 0);
  while (sum > 510) {
    let largest: StatID = STATS[0];
    for (const s of STATS) if ((evs[s] ?? 0) > (evs[largest] ?? 0)) largest = s;
    if (!evs[largest]) break;
    evs[largest] -= 4;
    sum -= 4;
  }
  return evs;
}

/**
 * Read an EV spread back as Champions stat points, for output a player can type
 * into the game. A maxed stat reads 32; because the two budgets differ (510 EVs
 * against 66 points) this is the nearest point spread, not an identity.
 */
export function evsToChampionsPoints(evs: Record<string, number>): Record<string, number> {
  const points: Record<string, number> = {};
  for (const s of STATS) {
    const ev = evs[s] ?? 0;
    if (ev > 0) points[s] = Math.min(CHAMPIONS_POINTS_MAX, Math.round(ev / EV_PER_CHAMPIONS_POINT));
  }
  return points;
}

export interface SetInput {
  species: string;
  level?: number;
  nature?: string;
  ivs?: Record<string, number>;
  evs?: Record<string, number>;
  /** Champions stat points, an alternative to `evs`; give one or the other, never both. */
  championsPoints?: Record<string, number>;
  item?: string;
  ability?: string;
  boosts?: Record<string, number>;
  status?: string;
  abilityOn?: boolean;
  curHP?: number;
  moves?: string[];
}

/**
 * Resolve a set's spread whichever scale it was given in: `evs` (0-252) or
 * `championsPoints` (0-32 each, 66 total). Giving both is an error rather than a
 * silent preference, so a caller can never think it supplied one and get the other.
 */
export function resolveEvs(
  evs: Record<string, number> | undefined,
  championsPoints: Record<string, number> | undefined,
): Record<string, number> {
  if (evs && championsPoints) throw new Error('You sent both evs and championsPoints; keep exactly one. evs is the 0-252 scale, championsPoints the Champions 0-32 scale (8 EVs = 1 CP, 66 total).');
  return championsPoints ? championsPointsToEvs(championsPoints) : cleanMap(evs, STATS, 'EV');
}

function cleanMap(map: Record<string, number> | undefined, allowed: readonly string[], label: string) {
  const out: Record<string, number> = {};
  if (!map) return out;
  for (const [k, v] of Object.entries(map)) {
    const key = k.toLowerCase();
    if (!allowed.includes(key)) throw new Error(`Unknown ${label} key "${k}"; allowed: ${allowed.join(', ')}.`);
    if (!Number.isFinite(v)) throw new Error(`Invalid ${label} value for "${k}": ${v}.`);
    out[key] = v;
  }
  return out;
}

/** Build a @smogon/calc Pokemon from a user-supplied set spec. */
export function buildPokemon(gen: GenerationNum, input: SetInput): Pokemon {
  const level = input.level ?? 100;
  if (level < 1 || level > 100) throw new Error('level must be 1-100.');

  const ivs = cleanMap(input.ivs, STATS, 'IV');
  const evs = resolveEvs(input.evs, input.championsPoints);
  for (const stat of STATS) {
    if (ivs[stat] !== undefined && (ivs[stat] < 0 || ivs[stat] > 31)) {
      throw new Error(`IV "${stat}" must be 0-31.`);
    }
    if (evs[stat] !== undefined && (evs[stat] < 0 || evs[stat] > 252)) {
      throw new Error(`EV "${stat}" must be 0-252.`);
    }
  }
  const evTotal = STATS.reduce((sum, s) => sum + (evs[s] ?? 0), 0);
  if (evTotal > 510) throw new Error(`EV total ${evTotal} exceeds 510.`);

  const nature = input.nature ?? 'Serious';
  const boosts = cleanMap(input.boosts, STATS, 'boost');
  for (const stat of STATS) {
    if (boosts[stat] !== undefined && (boosts[stat] < -6 || boosts[stat] > 6)) {
      throw new Error(`Boost "${stat}" must be -6..6.`);
    }
  }

  const options: Record<string, unknown> = {
    level,
    nature,
    ivs,
    evs,
    boosts,
  };
  if (input.item) options.item = input.item;
  if (input.ability) options.ability = input.ability;
  if (input.status) options.status = input.status;
  if (input.abilityOn !== undefined) options.abilityOn = input.abilityOn;
  if (input.curHP !== undefined) options.curHP = input.curHP;
  if (input.moves) options.moves = input.moves;

  return new Pokemon(getCalcGen(gen), input.species, options as never);
}

export interface FieldInput {
  gameType?: 'Singles' | 'Doubles';
  weather?: string;
  terrain?: string;
  attackerSide?: Record<string, unknown>;
  defenderSide?: Record<string, unknown>;
}

export function buildField(input: FieldInput = {}): Field {
  const field: Record<string, unknown> = {};
  if (input.gameType) field.gameType = input.gameType;
  if (input.weather) field.weather = input.weather;
  if (input.terrain) field.terrain = input.terrain;
  return new Field({
    ...field,
    attackerSide: new Side(input.attackerSide ?? {}),
    defenderSide: new Side(input.defenderSide ?? {}),
  } as never);
}

/** Run a full damage calculation and return a structured, LLM-friendly result. */
export function damageResult(
  gen: GenerationNum,
  attacker: SetInput,
  defender: SetInput,
  moveName: string,
  fieldInput: FieldInput = {},
) {
  const atk = buildPokemon(gen, attacker);
  const def = buildPokemon(gen, defender);
  const move = new CalcMove(getCalcGen(gen), moveName);
  const field = buildField(fieldInput);
  const result = calculate(getCalcGen(gen), atk, def, move, field);

  const atkStats = { ...atk.stats };
  const defStats = { ...def.stats };

  let desc = '';
  let kochance: { chance: number | undefined; n: number; text: string } | undefined;
  try {
    desc = result.desc();
    kochance = result.kochance();
  } catch {
    // calc's desc generator throws on 0-damage (immunity) edge cases.
    desc = `${attacker.species} ${moveName} vs. ${defender.species}: 0 damage (immune or invalid target).`;
  }

  const range = Array.isArray(result.damage)
    ? result.range()
    : ([result.damage, result.damage] as [number, number]);

  return {
    attacker: {
      species: atk.name,
      ...summarizeSet(atk),
      stats: atkStats,
    },
    defender: {
      species: def.name,
      ...summarizeSet(def),
      stats: defStats,
    },
    move: move.name,
    field: {
      gameType: field.gameType,
      weather: field.weather,
      terrain: field.terrain,
    },
    damage: result.damage,
    damageRange: range,
    koChance: kochance?.text ?? undefined,
    description: desc,
  };
}

function summarizeSet(p: Pokemon) {
  const evs: Record<string, number> = {};
  for (const s of STATS) if (p.evs[s]) evs[s] = p.evs[s];
  // Echo only what differs from the defaults. An all-31 IV spread and an all-zero
  // boost table are the same for every set, and cost ~140 bytes per side per call:
  // in a 30-defender `calculate_matchups` that is 4 KB of nothing.
  const customIvs = STATS.some((s) => p.ivs[s] !== 31);
  const boosted = STATS.some((s) => p.boosts[s] !== 0);
  return {
    level: p.level,
    nature: p.nature,
    evs,
    championsPoints: evsToChampionsPoints(evs),
    ...(customIvs ? { ivs: p.ivs } : {}),
    item: p.item,
    ability: p.ability,
    status: p.status || undefined,
    ...(boosted ? { boosts: p.boosts } : {}),
  };
}

/** Full 6-stat projection for a species at level/IV/EV/nature. */
export function statTable(
  gen: GenerationNum,
  base: Record<string, number>,
  level: number,
  ivs: Record<string, number>,
  evs: Record<string, number>,
  nature?: string,
) {
  const out: Record<string, number> = {};
  for (const s of STATS) {
    out[s] = finalStat(gen, s, base[s] ?? 0, ivs[s] ?? 31, evs[s] ?? 0, level, nature);
  }
  return out;
}
