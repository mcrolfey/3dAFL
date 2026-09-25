import type { MatchResult, ScheduledMatch, Season, Team } from "@3dafl/shared";
import { points } from "@3dafl/shared";
import { seedSeason } from "../persistence/seed.js";

export function nextScheduledMatch(season: Season): ScheduledMatch | null {
  return season.schedule.find((m) => !m.played) ?? null;
}

/**
 * Rolls over to the next year with the same lists: everyone keeps the attributes they've built up, ages a year,
 * and starts with fresh season stats and a fresh fixture. Mutates `teams`.
 */
export function startNextSeason(teams: Team[], previous: Season): Season {
  for (const team of teams) {
    for (const player of team.players) {
      player.age += 1;
      player.seasonStats = { matchesPlayed: 0, goals: 0, behinds: 0, disposals: 0, tackles: 0, marks: 0 };
    }
  }

  const season = seedSeason(teams, previous.year + 1);
  // Swap home grounds every other year and shuffle the fixture order so seasons don't repeat.
  if (season.year % 2 === 1) {
    for (const m of season.schedule) [m.homeTeamId, m.awayTeamId] = [m.awayTeamId, m.homeTeamId];
  }
  for (let i = season.schedule.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [season.schedule[i], season.schedule[j]] = [season.schedule[j], season.schedule[i]];
  }
  season.schedule.forEach((m, i) => (m.round = i + 1));
  return season;
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
