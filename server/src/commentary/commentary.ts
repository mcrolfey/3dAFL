import type { MatchClock, MatchEvent, ScoreLine, Team } from "@3dafl/shared";

export interface Line {
  text: string;
  /** 0 feed only, 1 routine, 2 notable, 3 big moment — the client decides what's worth saying out loud */
  priority: number;
}

const QUARTER_SECONDS = 20 * 60;
const QUARTER_NAMES = ["quarter time", "half time", "three-quarter time", "full time"];
const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];

function pick<T>(options: T[]): T {
  return options[Math.floor(Math.random() * options.length)];
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function points(s: ScoreLine): number {
  return s.goals * 6 + s.behinds;
}

function elapsed(clock: MatchClock): number {
  return (clock.quarter - 1) * QUARTER_SECONDS + (QUARTER_SECONDS - clock.secondsRemaining);
}

function distanceDescription(distance: number, angle: number): string {
  const spot = angle < 12 ? "dead in front" : angle < 30 ? "on a slight angle" : angle < 50 ? "on a tough angle" : "from the pocket";
  return `${distance} metres out, ${spot}`;
}

function shotOutlook(distance: number, angle: number): string {
  if (distance > 47) return "He'll need a big kick from there.";
  if (angle >= 50) return "Tough angle for him.";
  if (distance < 30 && angle < 30) return "He should kick this.";
  return "He's in range.";
}

/** Stat remarks only come at milestones, so the expert isn't reading out every increment. */
const DISPOSAL_MILESTONES = [12, 18, 25, 30];
const TACKLE_MILESTONES = [5, 8, 11];

const FILLER = [
  "The pressure around the ball has been ferocious.",
  "You can hear how loud this crowd is.",
  "Both sides are working hard to find space out there.",
  "The midfield battle is going to decide this one.",
  "The structure behind the ball has been really good.",
  "Whoever wins the clearances from here is going to have the edge.",
  "They're really moving the ball quickly by hand.",
];

/**
 * Broadcast commentary for one match. Keeps track of what's happened (goals, disposals, tackles, the margin, runs of
 * goals) so lines carry context, and chimes in with colour commentary during lulls.
 */
export class Commentator {
  private readonly names = new Map<string, string>();
  private readonly teamOf = new Map<string, string>();
  private readonly teamNames: Map<string, string>;
  private readonly homeId: string;
  private readonly awayId: string;
  private readonly goals = new Map<string, number>();
  private readonly disposals = new Map<string, number>();
  private readonly tackles = new Map<string, number>();
  private score: { home: ScoreLine; away: ScoreLine } = { home: { goals: 0, behinds: 0 }, away: { goals: 0, behinds: 0 } };
  private run = { teamId: "", goals: 0 };
  private lastNotableAt = 0;
  private lastRemarkAt = 0;
  private bouncesThisQuarter = 0;
  private readonly sharedSurnames = new Set<string>();
  private readonly milestonesSaid = new Set<string>();
  private readonly fillerUnused = [...FILLER];

  constructor(home: Team, away: Team) {
    this.homeId = home.id;
    this.awayId = away.id;
    this.teamNames = new Map([
      [home.id, home.name],
      [away.id, away.name],
    ]);
    const seen = new Set<string>();
    for (const team of [home, away]) {
      for (const p of team.players) {
        this.names.set(p.id, p.name);
        this.teamOf.set(p.id, team.id);
        const surname = p.name.split(" ").slice(-1)[0];
        if (seen.has(surname)) this.sharedSurnames.add(surname);
        seen.add(surname);
      }
    }
  }

  /** Surname, the way callers usually refer to players — full name when two players share it. */
  private who(id: string): string {
    const name = this.names.get(id) ?? "Unknown";
    const surname = name.split(" ").slice(-1)[0];
    return this.sharedSurnames.has(surname) ? name : surname;
  }

  private full(id: string): string {
    return this.names.get(id) ?? "Unknown";
  }

  /** "the Hawks" from "Ridgeline Hawks". */
  private nick(teamId: string): string {
    return `the ${(this.teamNames.get(teamId) ?? "Unknown").split(" ").slice(-1)[0]}`;
  }

  private margin(): string {
    const h = points(this.score.home);
    const a = points(this.score.away);
    if (h === a) return "Scores are level";
    const leader = h > a ? this.homeId : this.awayId;
    const nick = this.nick(leader);
    return `${nick.charAt(0).toUpperCase()}${nick.slice(1)} lead by ${Math.abs(h - a)}`;
  }

  private leader(stat: Map<string, number>): [string, number] | null {
    let best: [string, number] | null = null;
    for (const entry of stat) if (!best || entry[1] > best[1]) best = entry;
    return best;
  }

  private count(stat: Map<string, number>, id: string): number {
    const n = (stat.get(id) ?? 0) + 1;
    stat.set(id, n);
    return n;
  }

  private said(clock: MatchClock, line: Line | null): Line | null {
    // Routine chatter doesn't hold the expert back; only notable moments do.
    if (line && line.priority >= 2) this.lastNotableAt = elapsed(clock);
    return line;
  }

  describe(event: MatchEvent, clock: MatchClock): Line | null {
    return this.said(clock, this.lineFor(event, clock));
  }

  private lineFor(e: MatchEvent, clock: MatchClock): Line | null {
    switch (e.kind) {
      case "matchStart":
        return {
          text: `Welcome to the footy! ${e.home.name} take on ${e.away.name}, and there's a big crowd in for this one.`,
          priority: 3,
        };

      case "stoppage":
        if (e.type === "centerBounce") {
          this.bouncesThisQuarter++;
          if (this.bouncesThisQuarter === 1) {
            return clock.quarter === 1
              ? { text: "The umpire bounces the ball and we're underway!", priority: 3 }
              : { text: `The ${ORDINALS[clock.quarter - 1]} quarter is underway.`, priority: 2 };
          }
          return { text: pick(["Back to the centre.", "Ball's bounced in the middle again."]), priority: 1 };
        }
        return { text: e.type === "throwIn" ? "Boundary throw-in." : "Ball-up.", priority: 0 };

      case "hitout":
        return { text: pick([`${this.who(e.playerId)} wins the tap.`, `${this.who(e.playerId)} with the hitout.`]), priority: 0 };

      case "clearance":
        return { text: pick([`Clearance, ${this.who(e.playerId)}!`, `${this.who(e.playerId)} gets it out of the congestion.`]), priority: 1 };

      case "gather":
        return e.fromOpposition
          ? { text: pick([`Turnover! ${this.who(e.playerId)} swoops on it.`, `${this.who(e.playerId)} picks up the loose ball, turnover.`]), priority: 1 }
          : null;

      case "disposal": {
        this.count(this.disposals, e.playerId);
        const w = this.who(e.playerId);
        if (e.intent === "shootForGoal") return null;
        if (e.type === "handball") return e.quality < 0.3 ? { text: `${w} fires off a rushed handball.`, priority: 0 } : null;
        if (e.quality < 0.35) return { text: pick([`${w} sprays the kick.`, `Poor kick from ${w}.`]), priority: 1 };
        if (e.intent === "kickLong") return { text: pick([`${w} goes long.`, `${w} launches it forward.`]), priority: 0 };
        return e.targetPlayerId ? { text: `${w} finds ${this.who(e.targetPlayerId)}.`, priority: 0 } : null;
      }

      case "insideFifty":
        return { text: pick([`${this.who(e.playerId)} sends it inside fifty!`, `In it goes, inside fifty.`]), priority: 1 };

      case "playOn":
        return { text: pick([`${this.who(e.playerId)} plays on!`, `${this.who(e.playerId)} doesn't wait, plays on!`]), priority: 1 };

      case "bounce":
        return { text: pick([`${this.who(e.playerId)} takes a bounce!`, `${this.who(e.playerId)}, running hard, bounces it!`]), priority: 2 };

      case "mark": {
        const w = this.who(e.playerId);
        if (e.inScoringRange) {
          const opener = e.contested ? `Strong contested grab from ${w}` : `${w} marks`;
          return { text: `${opener}, ${distanceDescription(e.distanceToGoal, e.angleToGoalDeg)}. ${shotOutlook(e.distanceToGoal, e.angleToGoalDeg)}`, priority: 2 };
        }
        if (e.intercept) return { text: pick([`Great read! ${w} takes the intercept mark.`, `${w} cuts it off, intercept mark.`]), priority: 2 };
        if (e.contested) return { text: pick([`What a grab from ${w}!`, `${w} clunks it in the contest!`]), priority: 2 };
        return { text: pick([`${w} marks.`, `Easy mark for ${w}.`]), priority: 0 };
      }

      case "spoil":
        return { text: pick([`${this.who(e.playerId)} punches it away!`, `Good spoil from ${this.who(e.playerId)}.`]), priority: 1 };

      case "droppedMark":
        return { text: pick([`${this.who(e.playerId)} spills it!`, `Should've marked that, ${this.who(e.playerId)}.`]), priority: 1 };

      case "tackle": {
        const t = this.who(e.playerId);
        const c = this.who(e.opponentId);
        if (e.outcome === "broken") return { text: pick([`${c} shrugs off ${t}!`, `${c} breaks the tackle!`]), priority: 1 };
        const n = this.count(this.tackles, e.playerId);
        switch (e.outcome) {
          case "holdingTheBall":
            return { text: `Huge tackle from ${t}! Holding the ball!${n >= 5 ? ` That's his ${ORDINALS[n - 1] ?? `${n}th`} tackle.` : ""}`, priority: 2 };
          case "dispossessed":
            return { text: `${t} knocks it free from ${c}!`, priority: 1 };
          case "handballOut":
            return { text: `${c} gets the handball out as ${t} tackles.`, priority: 0 };
          case "ballUp":
            return { text: `${t} wraps up ${c}, ball's held in.`, priority: 0 };
        }
        return null;
      }

      case "freeKick":
        return e.reason === "holding the ball" ? null : { text: `Free kick to ${this.who(e.playerId)}, ${e.reason}.`, priority: 1 };

      case "outOfBounds":
        return e.onTheFull ? { text: "Out on the full! That'll be a free kick.", priority: 1 } : { text: "Out of bounds.", priority: 0 };

      case "shotAtGoal": {
        this.score = { home: e.homeScore, away: e.awayScore };
        const w = this.who(e.playerId);
        if (e.result === "goal") {
          const n = this.count(this.goals, e.playerId);
          this.run = this.run.teamId === e.teamId ? { teamId: e.teamId, goals: this.run.goals + 1 } : { teamId: e.teamId, goals: 1 };
          const tally = n === 1 ? "" : ` That's his ${ORDINALS[n - 1] ?? `${n}th`}!`;
          const streak = this.run.goals >= 3 ? ` ${this.run.goals} in a row for ${this.nick(e.teamId)}!` : "";
          const call = e.setShot ? pick([`${w} slots it from the set shot!`, `Straight through the middle, ${w}!`]) : pick([`${w} snaps it home!`, `What a finish from ${w}!`]);
          return { text: `GOAL! ${call}${tally}${streak} ${this.margin()}.`, priority: 3 };
        }
        if (e.result === "behind") return { text: pick([`${w} misses. Just the one point.`, `Off the boot of ${w}... it's a behind.`]), priority: 2 };
        return { text: pick([`${w}'s shot doesn't trouble the goal umpire.`, `${w} misses everything. That's a wasted chance.`]), priority: 2 };
      }

      case "rushedBehind":
        this.score = { home: e.homeScore, away: e.awayScore };
        return { text: "Rushed behind.", priority: 1 };

      case "kickIn":
        return { text: `${this.who(e.playerId)} takes the kick-in.`, priority: 0 };

      case "quarterEnd": {
        this.score = { home: e.homeScore, away: e.awayScore };
        this.bouncesThisQuarter = 0;
        if (e.quarter === 4) return null;
        const top = this.leader(this.goals);
        const star = top && top[1] >= 2 ? ` ${this.full(top[0])} has ${top[1]} goals.` : "";
        return { text: `That's the siren for ${QUARTER_NAMES[e.quarter - 1]}. ${this.margin()}.${star}`, priority: 3 };
      }

      case "fullTime": {
        this.score = { home: e.homeScore, away: e.awayScore };
        const h = points(e.homeScore);
        const a = points(e.awayScore);
        const top = this.leader(this.goals);
        const star = top && top[1] >= 2 ? ` ${this.full(top[0])} finishes with ${top[1]} goals.` : "";
        if (!e.winnerTeamId) return { text: `It's all over, and it's a draw! ${plural(h, "point")} apiece.${star}`, priority: 3 };
        const nick = this.nick(e.winnerTeamId);
        return { text: `The siren sounds and it's all over! ${nick.charAt(0).toUpperCase()}${nick.slice(1)} win by ${plural(Math.abs(h - a), "point")}.${star}`, priority: 3 };
      }

      case "frame":
      case "remark":
        return null;
    }
  }

  /** A stat line the first time a player reaches a milestone (e.g. 12 disposals), then not again until the next one. */
  private milestone(stat: Map<string, number>, milestones: number[], kind: string): [string, number] | null {
    for (const [id, n] of stat) {
      const reached = milestones.filter((m) => n >= m).pop();
      if (reached !== undefined && !this.milestonesSaid.has(`${kind}|${id}|${reached}`)) {
        this.milestonesSaid.add(`${kind}|${id}|${reached}`);
        return [id, n];
      }
    }
    return null;
  }

  /** Colour commentary from the expert when play's been quiet for a bit. */
  remark(clock: MatchClock): Line | null {
    const now = elapsed(clock);
    if (now - this.lastNotableAt < 6 || now - this.lastRemarkAt < 150) return null;
    this.lastRemarkAt = now;

    const h = points(this.score.home);
    const a = points(this.score.away);
    const minutesLeft = Math.ceil(clock.secondsRemaining / 60);

    // Most pressing thing first: a tight finish, then milestones, then the game's shape, then general chat.
    if (clock.quarter === 4 && Math.abs(h - a) <= 12 && minutesLeft <= 8) {
      const text =
        h === a
          ? `Scores level with ${plural(minutesLeft, "minute")} to go. This is thrilling stuff!`
          : `Just ${plural(Math.abs(h - a), "point")} in it with ${plural(minutesLeft, "minute")} left. Every contest matters now.`;
      return { text, priority: 2 };
    }
    const disposals = this.milestone(this.disposals, DISPOSAL_MILESTONES, "disposals");
    if (disposals) {
      return {
        text: pick([
          `${this.full(disposals[0])} is everywhere today, ${disposals[1]} disposals already.`,
          `${this.full(disposals[0])} keeps finding the footy. ${disposals[1]} touches so far.`,
        ]),
        priority: 1,
      };
    }
    const tackles = this.milestone(this.tackles, TACKLE_MILESTONES, "tackles");
    if (tackles) return { text: `${this.full(tackles[0])} has laid ${tackles[1]} tackles. Leading by example.`, priority: 1 };
    const goals = this.milestone(this.goals, [3, 5, 7], "goals");
    if (goals) return { text: `${this.full(goals[0])} is the danger man up forward. ${goals[1]} goals.`, priority: 1 };
    if (Math.abs(h - a) >= 24 && !this.milestonesSaid.has(`blowout|${clock.quarter}`)) {
      this.milestonesSaid.add(`blowout|${clock.quarter}`);
      const trailing = h < a ? this.homeId : this.awayId;
      return { text: `${this.nick(trailing).replace(/^the/, "The")} need something special. It's getting away from them.`, priority: 1 };
    }
    if (this.fillerUnused.length === 0) this.fillerUnused.push(...FILLER);
    const text = this.fillerUnused.splice(Math.floor(Math.random() * this.fillerUnused.length), 1)[0];
    return { text, priority: 1 };
  }
}
