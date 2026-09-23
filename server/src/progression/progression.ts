import type { AttributeKey, Player, Team } from "@3dafl/shared";
import type { PlayerMatchStats } from "./stats.js";

const GROWTH_CHANCE = 0.3;

function relevantAttributesFor(stats: PlayerMatchStats): AttributeKey[] {
  const attrs: AttributeKey[] = [];
  if (stats.goals > 0 || stats.behinds > 0) attrs.push("goalKicking");
  if (stats.tackles > 0) attrs.push("tackling");
  if (stats.marks > 0) attrs.push("marking");
  if (stats.disposals > 0) attrs.push("kicking", "handballing", "decisionMaking");
  if (attrs.length === 0) attrs.push("endurance", "speed");
  return attrs;
}

/** Nudges a player's attributes toward their potential based on how they performed this match. Mutates and returns the player. */
export function applyProgression(player: Player, stats: PlayerMatchStats): Player {
  const candidates = relevantAttributesFor(stats);
  for (const key of candidates) {
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

export function applyProgressionToTeam(team: Team, statsByPlayer: Map<string, PlayerMatchStats>): Team {
  for (const player of team.players) {
    const stats = statsByPlayer.get(player.id);
    if (stats) applyProgression(player, stats);
  }
  return team;
}
