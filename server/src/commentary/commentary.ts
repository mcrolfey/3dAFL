import type { MatchEvent, Team } from "@3dafl/shared";

export interface PlayerLookup {
  name(id: string): string;
  teamName(id: string): string;
}

export function buildPlayerLookup(home: Team, away: Team): PlayerLookup {
  const players = new Map<string, { name: string; teamId: string }>();
  for (const p of [...home.players, ...away.players]) players.set(p.id, { name: p.name, teamId: p.teamId });
  const teamNames = new Map([
    [home.id, home.name],
    [away.id, away.name],
  ]);
  return {
    name: (id) => players.get(id)?.name ?? "Unknown",
    teamName: (id) => teamNames.get(id) ?? players.get(id)?.teamId ?? "Unknown",
  };
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Converts a raw simulation event into a broadcast-style commentary line. Returns null for events with no narration. */
export function commentate(event: MatchEvent, lookup: PlayerLookup): string | null {
  switch (event.kind) {
    case "matchStart":
      return `Welcome to the match! ${event.home.name} take on ${event.away.name}.`;
    case "centerBounce":
      return pick([
        `${lookup.name(event.wonByPlayerId)} taps it down for ${lookup.teamName(event.wonByTeamId)}!`,
        `Great tap work from ${lookup.name(event.wonByPlayerId)}, ${lookup.teamName(event.wonByTeamId)} on the attack.`,
      ]);
    case "disposal":
      if (event.type === "handball") {
        return event.effective
          ? `${lookup.name(event.playerId)} handballs it off cleanly.`
          : `${lookup.name(event.playerId)} spills the handball!`;
      }
      return event.effective
        ? pick([
            `${lookup.name(event.playerId)} finds space with a nice kick.`,
            `${lookup.name(event.playerId)} switches it long down the field.`,
          ])
        : `${lookup.name(event.playerId)} sprays that kick, it's not a good ball.`;
    case "contest":
      if (event.type === "tackle") {
        return event.success
          ? `${lookup.name(event.playerId)} wraps up the tackle!`
          : `${lookup.name(event.opponentId ?? "")} shrugs off the tackle attempt.`;
      }
      if (event.type === "mark") {
        return event.success
          ? `Great grab! ${lookup.name(event.playerId)} takes the mark.`
          : `${lookup.name(event.opponentId ?? "")} spoils it away!`;
      }
      return null;
    case "turnover":
      return `Turnover! ${lookup.teamName(event.toTeamId)} scoop up the loose ball (${event.reason}).`;
    case "outOfBounds":
      return `Out of bounds, throw-in to follow.`;
    case "throwIn":
      return `${lookup.name(event.wonByPlayerId)} wins the throw-in for ${lookup.teamName(event.wonByTeamId)}.`;
    case "shotAtGoal":
      if (event.result === "goal") return `HE SLOTS IT! ${lookup.name(event.playerId)} kicks a goal for ${lookup.teamName(event.teamId)}!`;
      if (event.result === "behind") return `${lookup.name(event.playerId)} can only manage a behind.`;
      return `${lookup.name(event.playerId)}'s shot misses everything, no score.`;
    case "kickIn":
      return `${lookup.name(event.playerId)} plays on from the kick-in.`;
    case "quarterEnd":
      return `That's the end of quarter ${event.quarter}. ${event.homeScore.goals}.${event.homeScore.behinds} to ${event.awayScore.goals}.${event.awayScore.behinds}.`;
    case "fullTime":
      return `FULL TIME! Final score ${event.homeScore.goals}.${event.homeScore.behinds} to ${event.awayScore.goals}.${event.awayScore.behinds}.`;
    case "clockSync":
    case "positions":
      return null;
    default:
      return null;
  }
}
