import type { Player, Position } from "@3dafl/shared";
import type { Vec2 } from "./field.js";

export type Line = "back" | "centre" | "forward";

/** A named on-field position, expressed for a team attacking toward +x. */
export interface Slot {
  name: string;
  /** team-sheet abbreviation */
  abbr: string;
  line: Line;
  x: number;
  y: number;
}

// Mirrored so each back-line slot lines up with the opposition's matching forward slot.
// All back/forward slots sit inside the 50m arcs at centre bounces (the 6-6-6 rule).
const BACK: Slot[] = [
  { name: "Full back", abbr: "FB", line: "back", x: -76, y: 0 },
  { name: "Back pocket", abbr: "BP", line: "back", x: -70, y: -18 },
  { name: "Back pocket", abbr: "BP", line: "back", x: -70, y: 18 },
  { name: "Centre half-back", abbr: "CHB", line: "back", x: -46, y: 0 },
  { name: "Half-back flank", abbr: "HBF", line: "back", x: -50, y: -24 },
  { name: "Half-back flank", abbr: "HBF", line: "back", x: -50, y: 24 },
];

const CENTRE: Slot[] = [
  { name: "Ruck", abbr: "R", line: "centre", x: -1.5, y: 0 },
  { name: "Rover", abbr: "RO", line: "centre", x: -6, y: 6 },
  { name: "Ruck-rover", abbr: "RR", line: "centre", x: -6, y: -6 },
  { name: "Centre", abbr: "C", line: "centre", x: -10, y: 0 },
  { name: "Wing", abbr: "W", line: "centre", x: 0, y: -42 },
  { name: "Wing", abbr: "W", line: "centre", x: 0, y: 42 },
];

const FORWARD: Slot[] = [
  { name: "Full forward", abbr: "FF", line: "forward", x: 76, y: 0 },
  { name: "Forward pocket", abbr: "FP", line: "forward", x: 70, y: -18 },
  { name: "Forward pocket", abbr: "FP", line: "forward", x: 70, y: 18 },
  { name: "Centre half-forward", abbr: "CHF", line: "forward", x: 46, y: 0 },
  { name: "Half-forward flank", abbr: "HFF", line: "forward", x: 50, y: -24 },
  { name: "Half-forward flank", abbr: "HFF", line: "forward", x: 50, y: 24 },
];

export const ALL_SLOTS: Slot[] = [...BACK, ...CENTRE, ...FORWARD];

/**
 * Puts each player in a named position: defenders down back, the first ruck in the centre, midfielders on the ball
 * and wings, forwards (plus the spare ruck/midfielder) up forward. Falls back gracefully for unusual lists.
 */
export function assignSlots(players: Player[]): Map<string, Slot> {
  const pool = new Map<Position, Player[]>([
    ["DEF", players.filter((p) => p.position === "DEF")],
    ["MID", players.filter((p) => p.position === "MID")],
    ["FWD", players.filter((p) => p.position === "FWD")],
    ["RUCK", players.filter((p) => p.position === "RUCK")],
  ]);
  const take = (...prefs: Position[]): Player | undefined => {
    for (const pos of prefs) {
      const list = pool.get(pos)!;
      if (list.length > 0) return list.shift();
    }
    return undefined;
  };

  const result = new Map<string, Slot>();
  const place = (slot: Slot, player: Player | undefined) => {
    if (player) result.set(player.id, slot);
  };

  for (const slot of BACK) place(slot, take("DEF", "MID", "FWD", "RUCK"));
  place(CENTRE[0], take("RUCK", "MID", "DEF", "FWD"));
  for (const slot of CENTRE.slice(1)) place(slot, take("MID", "FWD", "DEF", "RUCK"));
  for (const slot of FORWARD) place(slot, take("FWD", "RUCK", "MID", "DEF"));

  // Anyone left over (non-standard list sizes) shares the nearest-to-centre slot rather than being dropped.
  for (const list of pool.values()) for (const p of list) result.set(p.id, CENTRE[3]);
  return result;
}

/** World position of a slot for a team attacking in `attackDir`. y isn't flipped so opposing pockets/wings line up. */
export function slotWorld(slot: Slot, attackDir: 1 | -1): Vec2 {
  return { x: slot.x * attackDir, y: slot.y };
}

/** The opposition slot that plays on this one (full back ↔ full forward, wing ↔ wing, and so on). */
export function mirrorSlotIndex(slot: Slot): number {
  const i = ALL_SLOTS.indexOf(slot);
  if (slot.line === "back") return 12 + i;
  if (slot.line === "forward") return i - 12;
  return i;
}
