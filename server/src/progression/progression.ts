import type { AttributeKey, Player, Team } from "@3dafl/shared";
import type { PlayerMatchStats } from "./stats.js";

const GROWTH_CHANCE = 0.3;

/** Attributes a player earns a chance to improve, based on what they did a lot of this match. */
function relevantAttributesFor(s: PlayerMatchStats): AttributeKey[] {
  const attrs: AttributeKey[] = [];
  if (s.goals + s.behinds >= 2) attrs.push("goalKicking");
  if (s.tackles >= 4) attrs.push("tackling");
  if (s.marks >= 5 || s.contestedMarks >= 2 || s.hitouts >= 15) attrs.push("marking");
  if (s.kicks >= 10) attrs.push("kicking");
  if (s.handballs >= 8) attrs.push("handballing");
  if (s.disposals >= 20 || s.clearances >= 4) attrs.push("decisionMaking");
  if (s.disposals >= 15) attrs.push("endurance");
  if (attrs.length === 0) attrs.push("speed");
  return attrs;
}

/** Nudges a player's attributes toward their potential based on how they performed this match. Mutates and returns the player. */
export function applyProgression(player: Player, stats: PlayerMatchStats): Player {
  for (const key of relevantAttributesFor(stats)) {
    if (Math.random() < GROWTH_CHANCE && player.attributes[key] < player.potential) {
      player.attributes[key] = Math.min(player.potential, player.attributes[key] + 1);
    }
  }

  player.seasonStats.matchesPlayed += 1;
  player.seasonStats.goals += stats.goals;
  player.seasonStats.behinds += stats.behinds;
  player.seasonStats.disposals += stats.disposals;
  player.seasonStats.tackles += stats.tackles;
  player.seasonStats.marks += stats.marks;
  player.careerGamesPlayed += 1;

  return player;
}

const NO_STATS: PlayerMatchStats = {
  kicks: 0,
  handballs: 0,
  disposals: 0,
  marks: 0,
  contestedMarks: 0,
  tackles: 0,
  goals: 0,
  behinds: 0,
  hitouts: 0,
  clearances: 0,
  insideFifties: 0,
  freesFor: 0,
  freesAgainst: 0,
};

export function applyProgressionToTeam(team: Team, statsByPlayer: Map<string, PlayerMatchStats>): Team {
  // Everyone who took the field played a game, even if they didn't register a stat.
  for (const player of team.players) applyProgression(player, statsByPlayer.get(player.id) ?? NO_STATS);
  return team;
}
