import type { MatchEvent } from "@3dafl/shared";

export interface PlayerMatchStats {
  kicks: number;
  handballs: number;
  disposals: number;
  marks: number;
  contestedMarks: number;
  tackles: number;
  goals: number;
  behinds: number;
  hitouts: number;
  clearances: number;
  insideFifties: number;
  freesFor: number;
}

export interface TeamMatchStats extends PlayerMatchStats {
  shots: number;
  rushedBehinds: number;
}

function emptyPlayerStats(): PlayerMatchStats {
  return {
    kicks: 0,
    handballs: 0,
    disposals: 0,
    marks: 0,
    contestedMarks: 0,
    tackles: 0,
    goals: 0,
    behinds: 0,
    hitouts: 0,
    clearances: 0,
    insideFifties: 0,
    freesFor: 0,
  };
}

/** Applies one event to the stat line of whoever it's credited to. */
function credit(event: MatchEvent, get: (id: string) => PlayerMatchStats) {
  switch (event.kind) {
    case "disposal": {
      const s = get(event.playerId);
      s.disposals++;
      if (event.type === "kick") s.kicks++;
      else s.handballs++;
      break;
    }
    case "mark": {
      const s = get(event.playerId);
      s.marks++;
      if (event.contested) s.contestedMarks++;
      break;
    }
    case "tackle":
      if (event.outcome !== "broken") get(event.playerId).tackles++;
      break;
    case "shotAtGoal":
      if (event.result === "goal") get(event.playerId).goals++;
      if (event.result === "behind") get(event.playerId).behinds++;
      break;
    case "hitout":
      get(event.playerId).hitouts++;
      break;
    case "clearance":
      get(event.playerId).clearances++;
      break;
    case "insideFifty":
      get(event.playerId).insideFifties++;
      break;
    case "freeKick":
      get(event.playerId).freesFor++;
      break;
  }
}

export function aggregateMatchStats(events: MatchEvent[]): Map<string, PlayerMatchStats> {
  const stats = new Map<string, PlayerMatchStats>();
  const get = (id: string) => {
    let s = stats.get(id);
    if (!s) {
      s = emptyPlayerStats();
      stats.set(id, s);
    }
    return s;
  };
  for (const event of events) credit(event, get);
  return stats;
}

export function aggregateTeamStats(events: MatchEvent[], teamOfPlayer: Map<string, string>): Map<string, TeamMatchStats> {
  const stats = new Map<string, TeamMatchStats>();
  const forTeam = (teamId: string) => {
    let s = stats.get(teamId);
    if (!s) {
      s = { ...emptyPlayerStats(), shots: 0, rushedBehinds: 0 };
      stats.set(teamId, s);
    }
    return s;
  };
  for (const event of events) {
    credit(event, (playerId) => forTeam(teamOfPlayer.get(playerId) ?? "unknown"));
    if (event.kind === "shotAtGoal") forTeam(event.teamId).shots++;
    if (event.kind === "rushedBehind") {
      const s = forTeam(event.teamId);
      s.behinds++;
      s.rushedBehinds++;
    }
  }
  return stats;
}
