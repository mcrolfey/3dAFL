import { loadTeams, loadSeason, saveTeams, saveSeason } from "./persistence/store.js";
import { nextScheduledMatch, recordMatchResult, sortedLadder, startNextSeason } from "./progression/season.js";
import { applyProgressionToTeam } from "./progression/progression.js";
import { aggregateMatchStats, aggregateTeamStats } from "./progression/stats.js";
import { createDecisionEngine } from "./jev/index.js";
import { runMatch } from "./matchRunner.js";
import { UNPACED_SPEED } from "./sim/engine.js";
import { formatStatsTable } from "./report.js";
import { points } from "@3dafl/shared";

async function main() {
  const teams = loadTeams();
  let season = loadSeason(teams);
  const decisionEngine = createDecisionEngine();

  if (!nextScheduledMatch(season)) {
    season = startNextSeason(teams, season);
    saveTeams(teams);
    saveSeason(season);
    console.log(`\nSeason complete — starting the ${season.year} season (players keep their attributes and are a year older).`);
  }
  const scheduled = nextScheduledMatch(season)!;

  const home = teams.find((t) => t.id === scheduled.homeTeamId)!;
  const away = teams.find((t) => t.id === scheduled.awayTeamId)!;

  console.log(`\n=== Round ${scheduled.round}: ${home.name} vs ${away.name} (decision engine: ${decisionEngine.name}) ===\n`);

  // Runs unpaced (as fast as possible) for quick checks — the live server paces play for real-time viewing instead.
  const { result, events } = await runMatch({
    matchId: scheduled.id,
    home,
    away,
    decisionEngine,
    simSpeed: UNPACED_SPEED,
    onEvent: (ce) => {
      if (!ce.text) return;
      const secs = Math.floor(ce.clock.secondsRemaining);
      console.log(`[Q${ce.clock.quarter} ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}] ${ce.text}`);
    },
  });

  console.log(
    `\nFinal: ${home.name} ${result.homeScore.goals}.${result.homeScore.behinds} (${points(result.homeScore)}) — ${away.name} ${result.awayScore.goals}.${result.awayScore.behinds} (${points(result.awayScore)})\n`,
  );

  const teamOfPlayer = new Map([...home.players, ...away.players].map((p) => [p.id, p.teamId]));
  const teamStats = aggregateTeamStats(events, teamOfPlayer);
  console.log(
    formatStatsTable([
      { label: home.name, stats: teamStats.get(home.id)! },
      { label: away.name, stats: teamStats.get(away.id)! },
    ]),
  );

  const matchStats = aggregateMatchStats(events);
  applyProgressionToTeam(home, matchStats);
  applyProgressionToTeam(away, matchStats);
  recordMatchResult(season, scheduled.id, result);
  saveTeams(teams);
  saveSeason(season);

  console.log("\nLadder:");
  for (const entry of sortedLadder(season)) {
    const team = teams.find((t) => t.id === entry.teamId)!;
    console.log(`  ${team.name}: ${entry.wins}-${entry.losses}-${entry.draws} (${entry.pointsFor} for / ${entry.pointsAgainst} against)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
