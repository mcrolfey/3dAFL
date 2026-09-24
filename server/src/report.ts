import type { TeamMatchStats } from "./progression/stats.js";

/** Approximate per-team, per-match averages from recent AFL seasons — the target the sim is tuned toward. */
export const AFL_AVERAGES: Partial<Record<keyof TeamMatchStats | "points" | "accuracy", number>> = {
  kicks: 205,
  handballs: 150,
  disposals: 355,
  marks: 88,
  contestedMarks: 11,
  tackles: 57,
  hitouts: 38,
  clearances: 37,
  insideFifties: 52,
  freesFor: 18,
  goals: 12.5,
  behinds: 10.5,
  shots: 25,
  points: 85,
  accuracy: 53,
};

const ROWS: (keyof TeamMatchStats | "points" | "accuracy")[] = [
  "points",
  "goals",
  "behinds",
  "accuracy",
  "shots",
  "disposals",
  "kicks",
  "handballs",
  "marks",
  "contestedMarks",
  "tackles",
  "hitouts",
  "clearances",
  "insideFifties",
  "freesFor",
];

function derived(s: TeamMatchStats, key: (typeof ROWS)[number]): number {
  if (key === "points") return s.goals * 6 + s.behinds;
  if (key === "accuracy") return s.goals + s.behinds > 0 ? (100 * s.goals) / (s.goals + s.behinds) : 0;
  return s[key];
}

/** Side-by-side table of stat lines (one column per label) against real AFL averages. */
export function formatStatsTable(columns: { label: string; stats: TeamMatchStats }[]): string {
  const width = 16;
  const header = ["Stat".padEnd(16), ...columns.map((c) => c.label.slice(0, width - 1).padStart(width)), "AFL avg".padStart(10)].join("");
  const lines = [header, "-".repeat(header.length)];
  for (const key of ROWS) {
    const cells = columns.map((c) => {
      const v = derived(c.stats, key);
      return (key === "accuracy" ? `${v.toFixed(0)}%` : Number.isInteger(v) ? String(v) : v.toFixed(1)).padStart(width);
    });
    const ref = AFL_AVERAGES[key];
    lines.push([key.padEnd(16), ...cells, (ref === undefined ? "" : key === "accuracy" ? `${ref}%` : String(ref)).padStart(10)].join(""));
  }
  return lines.join("\n");
}
