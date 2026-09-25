import { fantasyPoints, type Team, type TeamSummary } from "@3dafl/shared";
import { loadTeams } from "./persistence/store.js";
import { aggregateMatchStats, aggregateTeamStats, type TeamMatchStats } from "./progression/stats.js";
import { LocalHeuristicDecisionEngine } from "./jev/decisionEngine.js";
import { runMatch } from "./matchRunner.js";
import { UNPACED_SPEED } from "./sim/engine.js";
import { formatStatsTable } from "./report.js";

const LINES: Record<string, string[]> = {
  Backs: ["FB", "BP", "CHB", "HBF"],
  Midfield: ["C", "RO", "RR", "W"],
  Ruck: ["R"],
  Forwards: ["FF", "FP", "CHF", "HFF"],
};

/**
 * Approximate real AFL Fantasy figures per team per match. Real teams spread their total across 22 players (with
 * interchange); the sim plays 18 with no bench, so per-player figures are scaled up by 22/18 to compare like with like.
 */
const BENCH_SCALE = 22 / 18;
const FANTASY_REFERENCE: Record<string, number> = {
  "Team total AF": 1600,
  "Top AF": Math.round(125 * BENCH_SCALE),
  "Median AF": Math.round(80 * BENCH_SCALE),
  "Top disposals": Math.round(32 * 1.12),
  "Backs avg AF": Math.round(75 * BENCH_SCALE),
  "Midfield avg AF": Math.round(95 * BENCH_SCALE),
  "Ruck avg AF": Math.round(90 * BENCH_SCALE),
  "Forwards avg AF": Math.round(62 * BENCH_SCALE),
};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Simulates N matches on throwaway copies of the teams (nothing is saved) and reports average stats vs real AFL. */
async function main() {
  const matches = Number(process.argv[2] ?? 10);
  const teams: Team[] = JSON.parse(JSON.stringify(loadTeams()));
  const engine = new LocalHeuristicDecisionEngine();

  const totals: TeamMatchStats[] = [];
  const fantasy: Record<string, number>[] = [];
  const started = performance.now();
  for (let i = 0; i < matches; i++) {
    const home = teams[i % teams.length];
    const away = teams[(i + 1 + Math.floor(i / teams.length)) % teams.length];
    if (home === away) continue;
    let summaries: TeamSummary[] = [];
    const { events, result } = await runMatch({
      matchId: `calibrate-${i}`,
      home,
      away,
      decisionEngine: engine,
      simSpeed: UNPACED_SPEED,
      onEvent: (ce) => {
        if (ce.event.kind === "matchStart") summaries = [ce.event.home, ce.event.away];
      },
    });
    const teamOfPlayer = new Map([...home.players, ...away.players].map((p) => [p.id, p.teamId]));
    const stats = aggregateTeamStats(events, teamOfPlayer);
    totals.push(stats.get(home.id)!, stats.get(away.id)!);

    const playerStats = aggregateMatchStats(events);
    for (const team of summaries) {
      const lines = team.players.map((p) => {
        const s = playerStats.get(p.id);
        return { role: p.role, af: s ? fantasyPoints(s) : 0, disposals: s?.disposals ?? 0 };
      });
      const row: Record<string, number> = {
        "Team total AF": lines.reduce((sum, l) => sum + l.af, 0),
        "Top AF": Math.max(...lines.map((l) => l.af)),
        "Median AF": median(lines.map((l) => l.af)),
        "Top disposals": Math.max(...lines.map((l) => l.disposals)),
      };
      for (const [line, roles] of Object.entries(LINES)) {
        const inLine = lines.filter((l) => roles.includes(l.role));
        row[`${line} avg AF`] = inLine.reduce((sum, l) => sum + l.af, 0) / Math.max(1, inLine.length);
      }
      fantasy.push(row);
    }

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

  console.log("\nAFL Fantasy spread (per team per match; real figures scaled to an 18-player side)\n");
  for (const [key, ref] of Object.entries(FANTASY_REFERENCE)) {
    const value = fantasy.reduce((sum, row) => sum + row[key], 0) / fantasy.length;
    console.log(`${key.padEnd(18)}${value.toFixed(0).padStart(8)}${String(ref).padStart(10)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
