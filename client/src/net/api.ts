import type { LadderEntry, Season, Team } from "@3dafl/shared";

export interface StateResponse {
  teams: Team[];
  season: Season;
  ladder: LadderEntry[];
  decisionEngine: string;
  /** live match pace (sim seconds per real second) and the normal pace it returns to from real time */
  simSpeed: number;
  normalSpeed: number;
}

export async function fetchState(): Promise<StateResponse> {
  const res = await fetch("/api/state");
  return res.json();
}

export async function startNextSeason(): Promise<void> {
  await fetch("/api/season/next", { method: "POST" });
}

export async function setSpeed(simSpeed: number): Promise<void> {
  await fetch("/api/speed", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ simSpeed }) });
}

export async function startMatch(): Promise<{ matchId: string; homeTeamId: string; awayTeamId: string } | { error: string }> {
  const res = await fetch("/api/match/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  return res.json();
}
