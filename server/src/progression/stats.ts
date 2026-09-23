import type { MatchEvent } from "@3dafl/shared";

export interface PlayerMatchStats {
  disposals: number;
  tackles: number;
  marks: number;
  goals: number;
  behinds: number;
}

function emptyStats(): PlayerMatchStats {
  return { disposals: 0, tackles: 0, marks: 0, goals: 0, behinds: 0 };
}

export function aggregateMatchStats(events: MatchEvent[]): Map<string, PlayerMatchStats> {
  const stats = new Map<string, PlayerMatchStats>();
  const get = (id: string) => {
    let s = stats.get(id);
    if (!s) {
      s = emptyStats();
      stats.set(id, s);
    }
    return s;
  };

  for (const event of events) {
    switch (event.kind) {
      case "disposal":
        get(event.playerId).disposals++;
        break;
      case "contest":
        if (event.success && event.type === "tackle") get(event.playerId).tackles++;
        if (event.success && event.type === "mark") get(event.playerId).marks++;
        break;
      case "shotAtGoal":
        get(event.playerId).disposals++;
        if (event.result === "goal") get(event.playerId).goals++;
        if (event.result === "behind") get(event.playerId).behinds++;
        break;
    }
  }

  return stats;
}
