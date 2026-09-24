/**
 * Competitive capability taxonomy (spec §10).
 *
 * A capability is a curated, deterministic competitive tag the engine derives
 * from a move or ability. `search_dex` exposes these as typed filters. The LLM
 * SHALL NOT generate authoritative tags at query time — it maps user intent to
 * these tags; the engine owns the mapping.
 *
 * Move tags and ability tags are separate vocabularies.
 */
import { toID } from "./dex.js";

export interface MoveCapability {
  tag: string;
  description: string;
  moves: string[];
}

export interface AbilityCapability {
  tag: string;
  description: string;
  abilities: string[];
}

/** Curated deterministic move tags. */
export const MOVE_CAPABILITIES: MoveCapability[] = [
  {
    tag: "speed_control",
    description: "Controls the speed order (Tailwind, Trick Room, speed-lowering moves).",
    moves: ["Tailwind", "Trick Room", "Icy Wind", "Thunder Wave", "Glare", "Sticky Web", "Electroweb", "String Shot", "Bulldoze", "Scary Face", "Cotton Spore", "Rock Tomb"],
  },
  {
    tag: "priority",
    description: "Moves with positive priority that strike before most moves.",
    moves: ["Extreme Speed", "Sucker Punch", "Bullet Punch", "Mach Punch", "Ice Shard", "Aqua Jet", "Vacuum Wave", "Shadow Sneak", "Quick Attack", "Accelerock", "First Impression", "Thunderclap", "Jet Punch", "Grassy Glide"],
  },
  {
    tag: "spread_damage",
    description: "Multi-target damaging moves.",
    moves: ["Earthquake", "Rock Slide", "Heat Wave", "Surf", "Muddy Water", "Dazzling Gleam", "Discharge", "Eruption", "Water Spout", "Hyper Voice", "Snarl", "Bulldoze", "Electroweb", "Brutal Swing"],
  },
  {
    tag: "recovery",
    description: "Restores HP outside of items.",
    moves: ["Recover", "Roost", "Slack Off", "Soft-Boiled", "Milk Drink", "Shore Up", "Synthesis", "Moonlight", "Morning Sun", "Wish", "Jungle Healing", "Pollen Puff"],
  },
  {
    tag: "setup",
    description: "Boosts the user's (or a target's) stats.",
    moves: ["Swords Dance", "Nasty Plot", "Dragon Dance", "Calm Mind", "Bulk Up", "Quiver Dance", "Iron Defense", "Amnesia", "Belly Drum", "Curse", "Agility", "Rock Polish", "Coil", "Shell Smash", "Cotton Guard"],
  },
  {
    tag: "redirection",
    description: "Redirects opposing moves to a target of the team's choosing.",
    moves: ["Rage Powder", "Follow Me", "Spotlight"],
  },
  {
    tag: "protect",
    description: "A protecting move that blocks most attacks for a turn.",
    moves: ["Protect", "Detect", "Spiky Shield", "King's Shield", "Baneful Bunker", "Burning Bulwark", "Obstruct", "Silk Trap"],
  },
  {
    tag: "pivot",
    description: "Switches out while attacking or repositioning the team.",
    moves: ["U-turn", "Volt Switch", "Flip Turn", "Parting Shot", "Baton Pass", "Teleport", "Chilly Reception"],
  },
  {
    tag: "weather",
    description: "Sets or summons a weather condition.",
    moves: ["Sunny Day", "Rain Dance", "Sandstorm", "Hail", "Snowscape", "Chilly Reception"],
  },
  {
    tag: "terrain",
    description: "Sets an electric/psychic/grassy/misty terrain.",
    moves: ["Electric Terrain", "Psychic Terrain", "Grassy Terrain", "Misty Terrain"],
  },
  {
    tag: "fake_out",
    description: "Flinches on the first turn out; breaks Focus Sash leads.",
    moves: ["Fake Out"],
  },
  {
    tag: "status",
    description: "Inflicts a non-volatile status condition.",
    moves: ["Thunder Wave", "Will-O-Wisp", "Toxic", "Spore", "Sleep Powder", "Hypnosis", "Yawn", "Nuzzle", "Glare", "Toxic Thread"],
  },
  {
    tag: "stat_drop",
    description: "Lowers an opponent's stats.",
    moves: ["Parting Shot", "Snarl", "Icy Wind", "Memento", "Fake Tears", "Charm", "Eerie Impulse", "Scary Face", "Metal Sound", "Breaking Swipe", "Fire Lash"],
  },
  {
    tag: "stat_boost",
    description: "Raises the user's (or a target's) stats.",
    moves: ["Swords Dance", "Nasty Plot", "Dragon Dance", "Calm Mind", "Bulk Up", "Quiver Dance", "Iron Defense", "Amnesia", "Agility", "Rock Polish", "Coil", "Shell Smash", "Cotton Guard", "Belly Drum"],
  },
  {
    tag: "trick_room",
    description: "Reverses the speed order for several turns.",
    moves: ["Trick Room"],
  },
  {
    tag: "hazard_control",
    description: "Sets or removes entry hazards.",
    moves: ["Stealth Rock", "Spikes", "Toxic Spikes", "Sticky Web", "Rapid Spin", "Defog", "Court Change", "Mortal Spin", "Tidy Up"],
  },
  {
    tag: "disruption",
    description: "Restricts the opponent's options.",
    moves: ["Taunt", "Encore", "Disable", "Torment", "Snarl", "Knock Off", "Trick", "Switcheroo", "Whirlwind", "Roar"],
  },
];

/** Curated deterministic ability tags. */
export const ABILITY_CAPABILITIES: AbilityCapability[] = [
  {
    tag: "intimidate",
    description: "Lowers the opponent's Attack on entry.",
    abilities: ["Intimidate"],
  },
  {
    tag: "weather_setter",
    description: "Sets weather on entry.",
    abilities: ["Drizzle", "Drought", "Sand Stream", "Snow Warning", "Orichalcum Pulse"],
  },
  {
    tag: "terrain_setter",
    description: "Sets terrain on entry.",
    abilities: ["Electric Surge", "Psychic Surge", "Grassy Surge", "Misty Surge", "Hadron Engine"],
  },
  {
    tag: "immunity",
    description: "Grants an immunity to a type or class of move.",
    abilities: ["Levitate", "Water Absorb", "Volt Absorb", "Flash Fire", "Sap Sipper", "Lightning Rod", "Motor Drive", "Storm Drain", "Dry Skin", "Well-Baked Body", "Earth Eater", "Wonder Guard", "Bulletproof", "Soundproof", "Telepathy"],
  },
  {
    tag: "redirection",
    description: "Redirects opposing moves toward the ability holder.",
    abilities: ["Lightning Rod", "Storm Drain"],
  },
  {
    tag: "speed_modifier",
    description: "Modifies effective Speed.",
    abilities: ["Speed Boost", "Unburden", "Swift Swim", "Chlorophyll", "Sand Rush", "Slush Rush", "Surge Surfer", "Quick Feet"],
  },
  {
    tag: "damage_modifier",
    description: "Multiplies damage output.",
    abilities: ["Huge Power", "Pure Power", "Adaptability", "Technician", "Tough Claws", "Sheer Force", "Strong Jaw", "Iron Fist", "Mega Launcher", "Punk Rock", "Reckless", "Guts", "Hustle", "Defiant", "Competitive"],
  },
  {
    tag: "contact_punish",
    description: "Punishes contact moves.",
    abilities: ["Rough Skin", "Iron Barbs", "Static", "Flame Body", "Effect Spore", "Poison Point", "Aftermath", "Gooey", "Tangling Hair"],
  },
  {
    tag: "priority_modifier",
    description: "Changes the priority of moves.",
    abilities: ["Prankster", "Gale Wings", "Triage", "Queenly Majesty", "Dazzling", "Armor Tail"],
  },
];

export interface CapabilityIndex {
  tag: string;
  description: string;
  moveIds: Set<string>;
  abilityIds: Set<string>;
}

/** tag -> { moveIds, abilityIds } (a species holds a tag via an ability OR a learned move). */
export function buildCapabilityIndex(): Map<string, CapabilityIndex> {
  const out = new Map<string, CapabilityIndex>();
  for (const c of MOVE_CAPABILITIES) {
    const existing = out.get(c.tag) ?? { tag: c.tag, description: c.description, moveIds: new Set<string>(), abilityIds: new Set<string>() };
    for (const m of c.moves) existing.moveIds.add(toID(m));
    out.set(c.tag, existing);
  }
  for (const c of ABILITY_CAPABILITIES) {
    const existing = out.get(c.tag) ?? { tag: c.tag, description: c.description, moveIds: new Set<string>(), abilityIds: new Set<string>() };
    for (const a of c.abilities) existing.abilityIds.add(toID(a));
    out.set(c.tag, existing);
  }
  return out;
}
