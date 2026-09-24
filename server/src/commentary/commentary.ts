import type { MatchEvent, Team } from "@3dafl/shared";

export interface PlayerLookup {
  name(id: string): string;
  teamName(id: string): string;
}

export function buildPlayerLookup(home: Team, away: Team): PlayerLookup {
  const players = new Map<string, string>();
  for (const p of [...home.players, ...away.players]) players.set(p.id, p.name);
  const teamNames = new Map([
    [home.id, home.name],
    [away.id, away.name],
  ]);
  return {
    name: (id) => players.get(id) ?? "Unknown",
    teamName: (id) => teamNames.get(id) ?? "Unknown",
  };
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function scoreLine(e: { homeScore: { goals: number; behinds: number }; awayScore: { goals: number; behinds: number } }): string {
  const h = e.homeScore.goals * 6 + e.homeScore.behinds;
  const a = e.awayScore.goals * 6 + e.awayScore.behinds;
  return `${e.homeScore.goals}.${e.homeScore.behinds} (${h}) to ${e.awayScore.goals}.${e.awayScore.behinds} (${a})`;
}

/** Converts a raw simulation event into a broadcast-style commentary line. Returns null for events with no narration. */
export function commentate(event: MatchEvent, lookup: PlayerLookup): string | null {
  const n = (id: string) => lookup.name(id);
  switch (event.kind) {
    case "matchStart":
      return `Welcome to the match! ${event.home.name} take on ${event.away.name}.`;
    case "stoppage":
      if (event.type === "centerBounce") return pick(["The umpire bounces it in the centre...", "Ball's bounced, here we go..."]);
      if (event.type === "throwIn") return "Boundary umpire throws it back in.";
      return "Ball-up, the umpire throws it up.";
    case "hitout":
      return pick([`${n(event.playerId)} wins the hitout.`, `${n(event.playerId)} gets the tap down.`]);
    case "clearance":
      return pick([`${n(event.playerId)} clears it out of the congestion!`, `Clearance, ${n(event.playerId)}.`]);
    case "gather":
      return event.fromOpposition
        ? pick([`${n(event.playerId)} swoops on the loose ball, turnover!`, `Turnover, ${n(event.playerId)} picks it up.`])
        : null;
    case "disposal":
      if (event.intent === "shootForGoal") return null;
      if (event.type === "handball") return event.quality < 0.3 ? `${n(event.playerId)} fires off a rushed handball.` : null;
      if (event.quality < 0.35) return pick([`${n(event.playerId)} sprays that kick.`, `Poor kick from ${n(event.playerId)}.`]);
      if (event.intent === "kickLong") return pick([`${n(event.playerId)} goes long.`, `${n(event.playerId)} launches it forward.`]);
      return event.targetPlayerId
        ? pick([`${n(event.playerId)} looks for ${n(event.targetPlayerId)}...`, `${n(event.playerId)} hits up ${n(event.targetPlayerId)}...`])
        : null;
    case "playOn":
      return pick([`${n(event.playerId)} plays on!`, `${n(event.playerId)} doesn't wait, plays on!`]);
    case "bounce":
      return pick([`${n(event.playerId)} takes a bounce!`, `${n(event.playerId)} running hard, bounces it!`]);
    case "mark":
      if (event.intercept) return event.contested ? `Strong intercept mark, ${n(event.playerId)}!` : `${n(event.playerId)} cuts it off, intercept mark.`;
      return event.contested
        ? pick([`What a contested grab from ${n(event.playerId)}!`, `${n(event.playerId)} clunks it in the contest!`])
        : pick([`${n(event.playerId)} marks.`, `Easy mark for ${n(event.playerId)}.`]);
    case "spoil":
      return pick([`${n(event.playerId)} punches it away from ${n(event.opponentId)}!`, `Great spoil by ${n(event.playerId)}.`]);
    case "droppedMark":
      return pick([`${n(event.playerId)} can't hold the mark!`, `Dropped by ${n(event.playerId)}.`]);
    case "tackle":
      switch (event.outcome) {
        case "holdingTheBall":
          return `${n(event.playerId)} lays a big tackle on ${n(event.opponentId)} — holding the ball!`;
        case "ballUp":
          return `${n(event.playerId)} wraps up ${n(event.opponentId)}, ball's held in.`;
        case "dispossessed":
          return `${n(event.playerId)} knocks it free from ${n(event.opponentId)}!`;
        case "handballOut":
          return `${n(event.opponentId)} gets the handball away as ${n(event.playerId)} tackles.`;
        case "broken":
          return `${n(event.opponentId)} breaks the tackle of ${n(event.playerId)}!`;
      }
      return null;
    case "freeKick":
      return event.reason === "holding the ball" ? null : `Free kick to ${n(event.playerId)}, ${event.reason}.`;
    case "insideFifty":
      return null;
    case "outOfBounds":
      return event.onTheFull ? "Out on the full!" : "Out of bounds.";
    case "shotAtGoal": {
      const who = n(event.playerId);
      const style = event.setShot ? `set shot from ${event.distance} out` : `snap from ${event.distance} out`;
      if (event.result === "goal") return `GOAL! ${who} kicks it, ${style}! ${lookup.teamName(event.teamId)} — ${scoreLine(event)}.`;
      if (event.result === "behind") return `${who} misses, ${style}. Just a behind.`;
      return `${who}'s ${style} doesn't trouble the goal umpire.`;
    }
    case "rushedBehind":
      return `Rushed behind, a point to ${lookup.teamName(event.teamId)}.`;
    case "kickIn":
      return `${n(event.playerId)} takes the kick-in.`;
    case "quarterEnd":
      return `That's the end of the ${["first", "second", "third", "fourth"][event.quarter - 1]} quarter. ${scoreLine(event)}.`;
    case "fullTime":
      return `FULL TIME! Final score ${scoreLine(event)}.`;
    case "frame":
      return null;
  }
}
