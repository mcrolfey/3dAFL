import type { Team } from "@3dafl/shared";
import { loadTeams } from "./persistence/store.js";
import { aggregateTeamStats, type TeamMatchStats } from "./progression/stats.js";
import { LocalHeuristicDecisionEngine } from "./jev/decisionEngine.js";
import { runMatch } from "./matchRunner.js";
import { UNPACED_SPEED } from "./sim/engine.js";
import { formatStatsTable } from "./report.js";

/** Simulates N matches on throwaway copies of the teams (nothing is saved) and reports average team stats vs real AFL. */
async function main() {
  const matches = Number(process.argv[2] ?? 10);
  const teams: Team[] = JSON.parse(JSON.stringify(loadTeams()));
  const engine = new LocalHeuristicDecisionEngine();

  const totals: TeamMatchStats[] = [];
  const started = performance.now();
  for (let i = 0; i < matches; i++) {
    const home = teams[i % teams.length];
    const away = teams[(i + 1 + Math.floor(i / teams.length)) % teams.length];
    if (home === away) continue;
    const { events, result } = await runMatch({ matchId: `calibrate-${i}`, home, away, decisionEngine: engine, simSpeed: UNPACED_SPEED });
    const teamOfPlayer = new Map([...home.players, ...away.players].map((p) => [p.id, p.teamId]));
    const stats = aggregateTeamStats(events, teamOfPlayer);
    totals.push(stats.get(home.id)!, stats.get(away.id)!);
    const pts = (s: { goals: number; behinds: number }) => s.goals * 6 + s.behinds;
    console.log(
      `  ${home.name} ${result.homeScore.goals}.${result.homeScore.behinds} (${pts(result.homeScore)}) v ${away.name} ${result.awayScore.goals}.${result.awayScore.behinds} (${pts(result.awayScore)})`,
    );
  }

  const avg = {} as TeamMatchStats;
  for (const key of Object.keys(totals[0]) as (keyof TeamMatchStats)[]) {
    avg[key] = Math.round((totals.reduce((sum, s) => sum + s[key], 0) / totals.length) * 10) / 10;
  }
  console.log(`\nAverage per team over ${totals.length / 2} matches (${((performance.now() - started) / 1000).toFixed(1)}s):\n`);
  console.log(formatStatsTable([{ label: "Simulated", stats: avg }]));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
