/**
 * Engine-defined capability taxonomy.
 *
 * A capability is a competitive tag the engine derives from a move or ability
 * (e.g. `speed_control`, `pivot`, `intimidate`). `search_dex` exposes these as
 * typed constraint filters. The mapping is curated and deterministic — the
 * model never decides what a move "does"; the engine does.
 */
import { toID } from "./dex.js";

export interface Capability {
  tag: string;
  description: string;
  moves: string[];
  abilities: string[];
}

/**
 * The capability tags `search_dex` understands. Keep this list short and
 * mutually distinct so the router never hesitates between two tags.
 */
export const CAPABILITIES: Capability[] = [
  {
    tag: "speed_control",
    description:
      "Controls the speed order: Tailwind, Trick Room, or speed-lowering moves.",
    moves: [
      "Tailwind",
      "Trick Room",
      "Icy Wind",
      "Thunder Wave",
      "Glare",
      "Sticky Web",
      "Electroweb",
      "String Shot",
      "Bulldoze",
      "Scary Face",
      "Cotton Spore",
    ],
    abilities: [],
  },
  {
    tag: "pivot",
    description: "Switches out while attacking or repositioning the team.",
    moves: ["U-turn", "Volt Switch", "Flip Turn", "Parting Shot", "Baton Pass", "Teleport", "Chilly Reception"],
    abilities: [],
  },
  {
    tag: "intimidate",
    description: "Lowers the opponent's Attack on entry or by effect.",
    moves: [],
    abilities: ["Intimidate"],
  },
  {
    tag: "redirection",
    description: "Redirects opposing moves to a target of the team's choosing.",
    moves: ["Rage Powder", "Follow Me", "Spotlight"],
    abilities: [],
  },
  {
    tag: "weather",
    description: "Sets or summons a weather condition.",
    moves: ["Sunny Day", "Rain Dance", "Sandstorm", "Hail", "Snowscape", "Chilly Reception"],
    abilities: ["Drizzle", "Drought", "Sand Stream", "Snow Warning"],
  },
  {
    tag: "terrain",
    description: "Sets an electric/psychic/grassy/misty terrain.",
    moves: ["Electric Terrain", "Psychic Terrain", "Grassy Terrain", "Misty Terrain"],
    abilities: ["Electric Surge", "Psychic Surge", "Grassy Surge", "Misty Surge", "Hadron Engine"],
  },
  {
    tag: "screen",
    description: "Sets Reflect, Light Screen, or Aurora Veil.",
    moves: ["Reflect", "Light Screen", "Aurora Veil"],
    abilities: [],
  },
  {
    tag: "recovery",
    description: "Restores HP outside of items.",
    moves: ["Recover", "Roost", "Slack Off", "Soft-Boiled", "Milk Drink", "Shore Up", "Synthesis", "Moonlight", "Morning Sun", "Wish"],
    abilities: [],
  },
  {
    tag: "setup",
    description: "Boosts the user's (or a target's) stats.",
    moves: [
      "Swords Dance",
      "Nasty Plot",
      "Dragon Dance",
      "Calm Mind",
      "Bulk Up",
      "Quiver Dance",
      "Iron Defense",
      "Amnesia",
      "Belly Drum",
      "Curse",
      "Agility",
      "Rock Polish",
      "Coil",
      "Shell Smash",
    ],
    abilities: [],
  },
  {
    tag: "priority",
    description: "Moves with positive priority that strike before most moves.",
    moves: [
      "Extreme Speed",
      "Sucker Punch",
      "Bullet Punch",
      "Mach Punch",
      "Ice Shard",
      "Aqua Jet",
      "Vacuum Wave",
      "Shadow Sneak",
      "Quick Attack",
      "Accelerock",
      "First Impression",
      "Thunderclap",
      "Jet Punch",
    ],
    abilities: ["Prankster"],
  },
  {
    tag: "fake_out",
    description: "Flinches on the first turn out; breaks Focus Sash leads.",
    moves: ["Fake Out"],
    abilities: [],
  },
  {
    tag: "hazard",
    description: "Sets entry hazards on the opponent's field.",
    moves: ["Stealth Rock", "Spikes", "Toxic Spikes", "Sticky Web"],
    abilities: [],
  },
  {
    tag: "protect",
    description: "A protecting move that blocks most attacks for a turn.",
    moves: ["Protect", "Detect", "Spiky Shield", "King's Shield", "Baneful Bunker", "Burning Bulwark", "Obstruct", "Silk Trap"],
    abilities: [],
  },
  {
    tag: "unaware",
    description: "Ignores the opponent's stat changes when taking or dealing damage.",
    moves: [],
    abilities: ["Unaware"],
  },
];

/** tag -> { moveIds: Set<string>, abilityIds: Set<string> } */
export interface CapabilityIndex {
  tag: string;
  description: string;
  moveIds: Set<string>;
  abilityIds: Set<string>;
}

export function buildCapabilityIndex(): Map<string, CapabilityIndex> {
  const out = new Map<string, CapabilityIndex>();
  for (const c of CAPABILITIES) {
    out.set(c.tag, {
      tag: c.tag,
      description: c.description,
      moveIds: new Set(c.moves.map(toID)),
      abilityIds: new Set(c.abilities.map(toID)),
    });
  }
  return out;
}
