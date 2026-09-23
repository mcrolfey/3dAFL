import { loadTeams, loadSeason, saveTeams, saveSeason } from "./persistence/store.js";
import { nextScheduledMatch, recordMatchResult, sortedLadder } from "./progression/season.js";
import { applyProgressionToTeam } from "./progression/progression.js";
import { aggregateMatchStats } from "./progression/stats.js";
import { createDecisionEngine } from "./jev/index.js";
import { runMatch } from "./matchRunner.js";
import { points } from "@3dafl/shared";

async function main() {
  const teams = loadTeams();
  const season = loadSeason(teams);
  const decisionEngine = createDecisionEngine();

  const scheduled = nextScheduledMatch(season);
  if (!scheduled) {
    console.log("Season complete — no unplayed matches remain. Run `npm run headless -w server -- --reset` after deleting server/data/*.json to start a new season.");
    return;
  }

  const home = teams.find((t) => t.id === scheduled.homeTeamId)!;
  const away = teams.find((t) => t.id === scheduled.awayTeamId)!;

  console.log(`\n=== Round ${scheduled.round}: ${home.name} vs ${away.name} (decision engine: ${decisionEngine.name}) ===\n`);

  // Runs unpaced (near-instant) for fast debugging — the live server paces plays for real-time viewing instead.
  const { result, events } = await runMatch(
    scheduled.id,
    home,
    away,
    decisionEngine,
    async (ce) => {
      if (ce.text) {
        console.log(`[Q${ce.clock.quarter} ${Math.floor(ce.clock.secondsRemaining / 60)}:${String(ce.clock.secondsRemaining % 60).padStart(2, "0")}] ${ce.text}`);
      }
    },
    1_000_000,
  );

  console.log(`\nFinal: ${home.name} ${result.homeScore.goals}.${result.homeScore.behinds} (${points(result.homeScore)}) — ${away.name} ${result.awayScore.goals}.${result.awayScore.behinds} (${points(result.awayScore)})`);
  console.log(`Total events: ${events.length}`);

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
