import type { MatchResult, ScheduledMatch, Season } from "@3dafl/shared";
import { points } from "@3dafl/shared";

export function nextScheduledMatch(season: Season): ScheduledMatch | null {
  return season.schedule.find((m) => !m.played) ?? null;
}

export function recordMatchResult(season: Season, matchId: string, result: MatchResult): void {
  const match = season.schedule.find((m) => m.id === matchId);
  if (!match) throw new Error(`Unknown scheduled match ${matchId}`);

  match.played = true;
  match.result = result;

  const homePoints = points(result.homeScore);
  const awayPoints = points(result.awayScore);

  const homeEntry = season.ladder.find((l) => l.teamId === match.homeTeamId)!;
  const awayEntry = season.ladder.find((l) => l.teamId === match.awayTeamId)!;

  homeEntry.played += 1;
  awayEntry.played += 1;
  homeEntry.pointsFor += homePoints;
  homeEntry.pointsAgainst += awayPoints;
  awayEntry.pointsFor += awayPoints;
  awayEntry.pointsAgainst += homePoints;

  if (homePoints > awayPoints) {
    homeEntry.wins += 1;
    awayEntry.losses += 1;
  } else if (awayPoints > homePoints) {
    awayEntry.wins += 1;
    homeEntry.losses += 1;
  } else {
    homeEntry.draws += 1;
    awayEntry.draws += 1;
  }

  const remaining = nextScheduledMatch(season);
  season.currentRound = remaining ? remaining.round : season.currentRound + 1;
}

export function sortedLadder(season: Season) {
  return [...season.ladder].sort((a, b) => {
    const aPct = a.pointsFor / Math.max(1, a.pointsAgainst);
    const bPct = b.pointsFor / Math.max(1, b.pointsAgainst);
    if (b.wins !== a.wins) return b.wins - a.wins;
    return bPct - aPct;
  });
}
