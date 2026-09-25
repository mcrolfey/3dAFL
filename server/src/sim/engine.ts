import type {
  DecisionEngine,
  DisposalChoice,
  DisposalContext,
  MatchEvent,
  MatchFrame,
  ScoreLine,
  StoppageType,
  Team,
  TeamSummary,
  TackleOutcome,
} from "@3dafl/shared";
import { config } from "../config.js";
import { LocalHeuristicDecisionEngine, norm } from "../jev/decisionEngine.js";
import {
  angleToGoalDeg,
  classifyExit,
  clampInside,
  dist,
  distanceToGoal,
  GOAL_HALF_WIDTH,
  goalCenter,
  isInForward50,
  isInsideField,
  randomJitter,
  unit,
  type Vec2,
} from "./field.js";
import { ALL_SLOTS, assignSlots, mirrorSlotIndex, slotWorld } from "./formation.js";
import { flightHeight, kickRange, planPass, planShot, type FlightPlan } from "./kicking.js";
import { integrate, planMovement, type MoveMode, type MoveTarget } from "./movement.js";
import { AsyncDecision, createSimPlayer, type SimBall, type SimPlayer } from "./state.js";

const DT = 0.1;
export const FRAME_INTERVAL = 0.25;
const QUARTER_SECONDS = 20 * 60;
/** simSpeed at or above this runs as fast as possible with no real-time pacing (headless/calibration). */
export const UNPACED_SPEED = 10_000;
const GRAVITY = 9.8;

type Outcome = { success: boolean; confidence: number };
type DisposalDecision = { choice: DisposalChoice; confidence: number };
type Quality = { quality: number; confidence: number };

interface PossessionPhase {
  kind: "possession";
  carrier: SimPlayer;
  since: number;
  protectedPossession: boolean;
  markSpot: Vec2 | null;
  manOnMark: SimPlayer | null;
  isKickIn: boolean;
  priorOpportunity: boolean;
  running: boolean;
  decision: AsyncDecision<DisposalDecision> | null;
  choice: DisposalChoice | null;
  decidedAt: number;
  executeAt: number;
  exec: AsyncDecision<Quality> | null;
  runUntil: number;
  runDistance: number;
  lastPos: Vec2;
}

interface FlightPhase {
  kind: "flight";
  kicker: SimPlayer;
  type: "kick" | "handball";
  intent: DisposalChoice;
  from: Vec2;
  plan: FlightPlan;
  t0: number;
  distance: number;
  quality: number;
  target: SimPlayer | null;
  predictedDefender: SimPlayer | null;
  markDecision: AsyncDecision<Outcome> | null;
  isShot: boolean;
  setShot: boolean;
  shotDistance: number;
}

interface LoosePhase {
  kind: "loose";
  since: number;
  congestionSince: number | null;
}

interface StoppagePhase {
  kind: "stoppage";
  type: StoppageType;
  at: Vec2;
  readyBy: number;
  deadline: number;
  rucks: [SimPlayer, SimPlayer];
  ruckDecision: AsyncDecision<Outcome>;
}

interface DeadPhase {
  kind: "dead";
  until: number;
  targets: Map<SimPlayer, MoveTarget>;
  next: () => void;
  /** optional per-tick work while play is stopped, e.g. returning the ball to the centre */
  tick?: () => void;
}

type Phase = PossessionPhase | FlightPhase | LoosePhase | StoppagePhase | DeadPhase;

function teamSummary(team: Team): TeamSummary {
  return {
    id: team.id,
    name: team.name,
    color: team.color,
    players: team.players.map((p, i) => ({ id: p.id, name: p.name, position: p.position, number: i + 1 })),
  };
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface MatchSimOptions {
  matchId: string;
  home: Team;
  away: Team;
  decisionEngine: DecisionEngine;
  /** Sim-clock seconds per real second. Defaults to config.simSpeed; UNPACED_SPEED or above runs as fast as possible. */
  simSpeed?: number;
}

class MatchSim {
  t = 0;
  quarter: 1 | 2 | 3 | 4 = 1;
  remaining = QUARTER_SECONDS;
  score: [ScoreLine, ScoreLine] = [
    { goals: 0, behinds: 0 },
    { goals: 0, behinds: 0 },
  ];
  finished = false;
  readonly players: SimPlayer[] = [];
  readonly teams: [SimPlayer[], SimPlayer[]] = [[], []];
  ball: SimBall = {
    x: 0,
    y: 0,
    z: 1,
    vx: 0,
    vy: 0,
    vz: 0,
    state: "dead",
    lastTouchTeam: 0,
    lastKicker: null,
    untouchedSinceKick: false,
  };
  phase!: Phase;

  private afterSiren = false;
  private sirenGrace: Phase | null = null;
  private pendingClearance = false;
  private out: MatchEvent[] = [];
  private readonly local = new LocalHeuristicDecisionEngine();
  private readonly teamIds: [string, string];

  constructor(
    private readonly opts: MatchSimOptions,
    private readonly unpaced: boolean,
  ) {
    this.teamIds = [opts.home.id, opts.away.id];
    [opts.home, opts.away].forEach((team, teamIdx) => {
      const slots = assignSlots(team.players);
      for (const player of team.players) {
        const slot = slots.get(player.id)!;
        const sp = createSimPlayer(this.players.length, player, teamIdx as 0 | 1, slot, slotWorld(slot, this.attackDir(teamIdx as 0 | 1)));
        this.players.push(sp);
        this.teams[teamIdx].push(sp);
      }
    });
    for (const p of this.players) {
      const mirror = ALL_SLOTS[mirrorSlotIndex(p.slot)];
      p.matchup = this.teams[p.team === 0 ? 1 : 0].find((o) => o.slot === mirror) ?? null;
    }
    this.startCentreBounce();
  }

  // --- helpers ---

  attackDir(team: 0 | 1): 1 | -1 {
    const home: 1 | -1 = this.quarter % 2 === 1 ? 1 : -1;
    return team === 0 ? home : ((home * -1) as 1 | -1);
  }

  private opponentsOf(team: 0 | 1): SimPlayer[] {
    return this.teams[team === 0 ? 1 : 0];
  }

  private nearestTo(players: SimPlayer[], pos: Vec2, exclude?: SimPlayer): SimPlayer | null {
    let best: SimPlayer | null = null;
    let bestD = Infinity;
    for (const p of players) {
      if (p === exclude || p.stunnedUntil > this.t) continue;
      const d = dist(p.pos, pos);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  private nearestOpponentDistance(p: SimPlayer): number {
    const opp = this.nearestTo(this.opponentsOf(p.team), p.pos);
    return opp ? dist(opp.pos, p.pos) : 99;
  }

  private emit(e: MatchEvent) {
    this.out.push(e);
  }

  drain(): MatchEvent[] {
    const events = this.out;
    this.out = [];
    return events;
  }

  private scoreEventFields() {
    return { homeScore: { ...this.score[0] }, awayScore: { ...this.score[1] } };
  }

  private clockRunning(): boolean {
    if (this.afterSiren) return false;
    if (this.phase.kind === "dead") return false;
    if (this.phase.kind === "stoppage" && this.phase.type !== "ballUp") return false;
    return true;
  }

  startEvent(simSpeed: number): MatchEvent {
    return {
      kind: "matchStart",
      matchId: this.opts.matchId,
      home: teamSummary(this.opts.home),
      away: teamSummary(this.opts.away),
      simSpeed,
      frameInterval: FRAME_INTERVAL,
    };
  }

  frame(): MatchFrame {
    const players: number[] = [];
    for (const p of this.players) players.push(round1(p.pos.x), round1(p.pos.y));
    return {
      clock: { quarter: this.quarter, secondsRemaining: Math.max(0, round1(this.remaining)) },
      clockRunning: this.clockRunning(),
      ball: [round1(this.ball.x), round1(this.ball.y), Math.round(this.ball.z * 100) / 100],
      carrierIndex: this.phase.kind === "possession" ? this.phase.carrier.idx : -1,
      players,
    };
  }

  // --- main loop ---

  async step() {
    const overrides = new Map<SimPlayer, MoveTarget>();
    const ph = this.phase;
    switch (ph.kind) {
      case "possession":
        await this.tickPossession(ph, overrides);
        break;
      case "flight":
        await this.tickFlight(ph, overrides);
        break;
      case "loose":
        this.tickLoose(ph);
        break;
      case "stoppage":
        await this.tickStoppage(ph, overrides);
        break;
      case "dead":
        for (const [p, target] of ph.targets) overrides.set(p, target);
        ph.tick?.();
        if (this.t >= ph.until) ph.next();
        break;
    }
    if (this.finished) return;

    if (this.afterSiren && this.phase !== this.sirenGrace) {
      this.endQuarter();
      if (this.finished) return;
    }

    const carrier = this.phase.kind === "possession" ? this.phase.carrier : null;
    const targets = planMovement(this.players, {
      t: this.t,
      mode: this.moveMode(),
      focus: this.focus(),
      focusVel: { x: this.ball.vx, y: this.ball.vy },
      possTeam: this.possessionTeam(),
      carrier,
      attackDirOf: (team) => this.attackDir(team),
      overrides,
    });
    integrate(this.players, targets, DT, this.t, carrier);

    if (carrier) {
      const dir = this.attackDir(carrier.team);
      this.ball.x = carrier.pos.x + dir * 0.3;
      this.ball.y = carrier.pos.y;
      this.ball.z = 1.0;
      this.ball.vx = carrier.vel.x;
      this.ball.vy = carrier.vel.y;
    }

    this.t += DT;
    if (this.clockRunning()) {
      this.remaining -= DT;
      if (this.remaining <= 0) this.handleSiren();
    }
  }

  private moveMode(): MoveMode {
    const ph = this.phase;
    if (ph.kind === "possession") return ph.protectedPossession ? "protected" : "possession";
    return ph.kind;
  }

  private focus(): Vec2 {
    const ph = this.phase;
    if (ph.kind === "flight") return ph.plan.to;
    if (ph.kind === "stoppage") return ph.at;
    return { x: this.ball.x, y: this.ball.y };
  }

  private possessionTeam(): 0 | 1 | null {
    const ph = this.phase;
    if (ph.kind === "possession") return ph.carrier.team;
    if (ph.kind === "flight") return ph.kicker.team;
    if (ph.kind === "loose") return this.ball.lastTouchTeam;
    return null;
  }

  // --- siren / quarters ---

  private handleSiren() {
    this.remaining = 0;
    if (this.afterSiren) return;
    const ph = this.phase;
    // A kick already in the air still counts, and a mark or free paid before the siren gets its kick.
    if ((ph.kind === "flight" && ph.type === "kick") || (ph.kind === "possession" && ph.protectedPossession)) {
      this.afterSiren = true;
      this.sirenGrace = ph;
      return;
    }
    this.endQuarter();
  }

  private endQuarter() {
    this.emit({ kind: "quarterEnd", quarter: this.quarter, ...this.scoreEventFields() });
    this.afterSiren = false;
    this.sirenGrace = null;

    if (this.quarter === 4) {
      const [h, a] = this.score.map((s) => s.goals * 6 + s.behinds);
      this.emit({
        kind: "fullTime",
        ...this.scoreEventFields(),
        winnerTeamId: h > a ? this.teamIds[0] : a > h ? this.teamIds[1] : null,
      });
      this.finished = true;
      return;
    }

    this.quarter = (this.quarter + 1) as 1 | 2 | 3 | 4;
    this.remaining = QUARTER_SECONDS;
    // Quarter break: everyone recovers and lines up for the next bounce (teams have swapped ends).
    for (const p of this.players) {
      p.fatigue *= 0.4;
      const home = slotWorld(p.slot, this.attackDir(p.team));
      p.pos = { ...home };
      p.vel = { x: 0, y: 0 };
      p.stunnedUntil = 0;
    }
    this.placeBall({ x: 0, y: 0 }, 1);
    this.phase = { kind: "dead", until: this.t + 8, targets: new Map(), next: () => this.startCentreBounce() };
  }

  private placeBall(at: Vec2, z: number) {
    Object.assign(this.ball, { x: at.x, y: at.y, z, vx: 0, vy: 0, vz: 0, state: "dead" as const });
  }

  // --- stoppages ---

  private startCentreBounce() {
    this.placeBall({ x: 0, y: 0 }, 1.2);
    const rucks = [0, 1].map((team) => this.teams[team].find((p) => p.slot.name === "Ruck") ?? this.teams[team][0]) as [SimPlayer, SimPlayer];
    this.phase = {
      kind: "stoppage",
      type: "centerBounce",
      at: { x: 0, y: 0 },
      readyBy: this.t + 2,
      deadline: this.t + 20,
      rucks,
      ruckDecision: this.ruckContest(rucks),
    };
  }

  private startStoppage(type: "ballUp" | "throwIn", at: Vec2) {
    const spot = clampInside(at, 3);
    this.placeBall(spot, 0.4);
    const rucks = ([0, 1] as const).map((team) => {
      const ruck = this.teams[team].find((p) => p.player.position === "RUCK" && dist(p.pos, spot) < 30 && p.stunnedUntil <= this.t);
      return ruck ?? this.nearestTo(this.teams[team], spot) ?? this.teams[team][0];
    }) as [SimPlayer, SimPlayer];
    this.phase = {
      kind: "stoppage",
      type,
      at: spot,
      readyBy: this.t + (type === "ballUp" ? 5 : 4),
      deadline: this.t + (type === "ballUp" ? 9 : 7),
      rucks,
      ruckDecision: this.ruckContest(rucks),
    };
  }

  private ruckContest(rucks: [SimPlayer, SimPlayer]): AsyncDecision<Outcome> {
    const ctx = { kind: "ruck" as const, attackerAttributes: rucks[0].player.attributes, defenderAttributes: rucks[1].player.attributes };
    return new AsyncDecision(this.opts.decisionEngine.decideContest(ctx), () => this.local.decideContest(ctx), this.t);
  }

  private async tickStoppage(ph: StoppagePhase, overrides: Map<SimPlayer, MoveTarget>) {
    const ruckSpots = ph.rucks.map((r) => ({ x: ph.at.x - this.attackDir(r.team) * 1.2, y: ph.at.y }));
    ph.rucks.forEach((r, i) => overrides.set(r, { pos: ruckSpots[i], sprint: true }));

    if (ph.type === "centerBounce") {
      for (const p of this.players) {
        if (!overrides.has(p)) {
          const home = slotWorld(p.slot, this.attackDir(p.team));
          overrides.set(p, { pos: home, sprint: dist(p.pos, home) > 8 });
        }
      }
    } else {
      // Three onballers from each side crowd around the contest.
      for (const team of this.teams) {
        const around = team
          .filter((p) => !overrides.has(p))
          .sort((a, b) => dist(a.pos, ph.at) - dist(b.pos, ph.at))
          .slice(0, 3);
        around.forEach((p, i) => {
          const angle = (i / 3) * Math.PI * 2 + (p.team === 0 ? 0 : Math.PI / 3);
          overrides.set(p, { pos: clampInside({ x: ph.at.x + Math.cos(angle) * 4.5, y: ph.at.y + Math.sin(angle) * 4.5 }, 1), sprint: true });
        });
      }
    }

    const settled =
      ph.type === "centerBounce"
        ? this.players.every((p) => dist(p.pos, overrides.get(p)!.pos) < 2.5)
        : ph.rucks.every((r, i) => dist(r.pos, ruckSpots[i]) < 1.5);
    if (this.t < ph.readyBy || (!settled && this.t < ph.deadline)) return;

    const result = await ph.ruckDecision.poll(this.t, ph.deadline - ph.ruckDecision.startedAt + 1.5, this.unpaced);
    if (!result) return;

    this.emit({ kind: "stoppage", type: ph.type, at: ph.at });
    const winner = result.success ? ph.rucks[0] : ph.rucks[1];
    this.emit({ kind: "hitout", playerId: winner.player.id, teamId: this.teamIds[winner.team] });

    // Most hitouts go to advantage — tapped toward a teammate — the rest spill anywhere.
    const mate = this.nearestTo(this.teams[winner.team], ph.at, winner);
    const toAdvantage = mate && Math.random() < 0.55 + 0.3 * norm(winner.player.attributes.marking);
    const dirTap = toAdvantage ? unit(ph.at, mate!.pos) : unit({ x: 0, y: 0 }, { x: randomJitter(1), y: randomJitter(1) });
    const speed = 4 + Math.random() * 4;
    Object.assign(this.ball, { x: ph.at.x, y: ph.at.y, z: 3, vx: dirTap.x * speed, vy: dirTap.y * speed, vz: -1, state: "ground" as const });
    this.ball.lastTouchTeam = winner.team;
    this.ball.lastKicker = null;
    this.ball.untouchedSinceKick = false;
    this.pendingClearance = true;
    this.phase = { kind: "loose", since: this.t, congestionSince: null };
  }

  // --- possession ---

  private startPossession(p: SimPlayer, opts: { protectedPossession: boolean; markSpot?: Vec2; kickIn?: boolean }) {
    this.ball.state = "held";
    this.ball.lastTouchTeam = p.team;
    this.ball.lastKicker = null;
    this.ball.untouchedSinceKick = false;
    const markSpot = opts.markSpot ?? null;
    this.phase = {
      kind: "possession",
      carrier: p,
      since: this.t,
      protectedPossession: opts.protectedPossession,
      markSpot,
      manOnMark: markSpot && !opts.kickIn ? this.nearestTo(this.opponentsOf(p.team), markSpot) : null,
      isKickIn: opts.kickIn ?? false,
      priorOpportunity: false,
      running: false,
      decision: null,
      choice: null,
      decidedAt: 0,
      executeAt: Infinity,
      exec: null,
      runUntil: 0,
      runDistance: 0,
      lastPos: { ...p.pos },
    };
  }

  private inScoringRange(p: SimPlayer, protectedPossession: boolean): boolean {
    const dir = this.attackDir(p.team);
    const d = distanceToGoal(p.pos, dir);
    const angle = angleToGoalDeg(p.pos, dir);
    const maxRange = (protectedPossession ? 50 : 42) + 10 * norm(p.player.attributes.goalKicking);
    return d <= maxRange && angle <= (d < 20 ? 75 : 62);
  }

  private disposalContext(ph: PossessionPhase): DisposalContext {
    const c = ph.carrier;
    const dir = this.attackDir(c.team);
    const nearestOpp = this.nearestOpponentDistance(c);
    const mates = this.teams[c.team].filter((m) => m !== c && m.stunnedUntil <= this.t);
    const nearby = mates.filter((m) => dist(m.pos, c.pos) < 18 && this.nearestOpponentDistance(m) > 2.5);
    const range = kickRange(c.player.attributes.kicking);
    const openAhead = mates.filter((m) => {
      const d = dist(m.pos, c.pos);
      return (m.pos.x - c.pos.x) * dir > 5 && d > 15 && d < range && this.nearestOpponentDistance(m) > 4;
    });
    return {
      playerId: c.player.id,
      attributes: c.player.attributes,
      fieldPos: { x: c.pos.x, y: c.pos.y },
      attackingDirection: dir,
      inForward50: isInForward50(c.pos, dir),
      underPressure: !ph.protectedPossession && nearestOpp < 3,
      nearbyTeammateIds: nearby.map((m) => m.player.id),
      distanceToGoal: distanceToGoal(c.pos, dir),
      angleToGoalDeg: angleToGoalDeg(c.pos, dir),
      inScoringRange: this.inScoringRange(c, ph.protectedPossession),
      protectedPossession: ph.protectedPossession,
      nearestOpponentDistance: nearestOpp,
      openTeammatesAhead: openAhead.length,
    };
  }

  private reactionTime(choice: DisposalChoice, ph: PossessionPhase): number {
    if (ph.protectedPossession) {
      if (choice === "shootForGoal") return 22 + Math.random() * 7; // set-shot routine, inside the 30-second limit
      if (ph.isKickIn) return 5 + Math.random() * 4;
      return 4.5 + Math.random() * 5; // back to the mark, look for options
    }
    // Unpressured players take their time to look for options; under pressure they get rid of it.
    const base = choice === "handball" ? 0.6 + Math.random() * 0.6 : 2 + Math.random() * 2;
    return this.nearestOpponentDistance(ph.carrier) < 3 ? base * 0.35 : base;
  }

  private async tickPossession(ph: PossessionPhase, overrides: Map<SimPlayer, MoveTarget>) {
    const c = ph.carrier;
    const dir = this.attackDir(c.team);
    const goal = goalCenter(dir);

    this.setCarrierMovement(ph, overrides, goal);

    if (!ph.protectedPossession && this.checkTackle(ph)) return;

    if (!ph.decision) {
      const ctx = this.disposalContext(ph);
      ph.decision = new AsyncDecision(this.opts.decisionEngine.decideDisposal(ctx), () => this.local.decideDisposal(ctx), this.t);
    }

    if (ph.choice === null) {
      const decided = await ph.decision.poll(this.t, ph.protectedPossession ? 3 : 1.2, this.unpaced);
      if (!decided) return;
      const ctx = this.disposalContext(ph);
      let choice = decided.choice;
      if (choice === "shootForGoal" && !ctx.inScoringRange) choice = "kickLong";
      if (this.afterSiren && choice === "run") choice = ctx.inScoringRange ? "shootForGoal" : "kickLong";
      if (choice === "handball" && !this.pickPassTarget(c, "handball")) choice = "kickShort";
      ph.choice = choice;
      ph.decidedAt = this.t;

      if (choice === "run") {
        if (ph.protectedPossession) {
          ph.protectedPossession = false;
          this.emit({ kind: "playOn", playerId: c.player.id });
        }
        ph.running = true;
        ph.priorOpportunity = true;
        ph.runUntil = this.t + 1.5 + Math.random() * 2.5;
      } else {
        ph.running = false;
        ph.executeAt = this.t + this.reactionTime(choice, ph);
        const pressure = ctx.nearestOpponentDistance < 2 ? 0.8 : ctx.nearestOpponentDistance < 5 ? 0.4 : 0;
        const execCtx = { playerId: c.player.id, attributes: c.player.attributes, disposal: choice, pressure };
        ph.exec = new AsyncDecision(
          this.opts.decisionEngine.decideExecutionQuality(execCtx),
          () => this.local.decideExecutionQuality(execCtx),
          this.t,
        );
      }
      return;
    }

    if (ph.choice === "run") {
      if (this.t >= ph.runUntil || this.nearestOpponentDistance(c) < 2.5) {
        ph.decision = null;
        ph.choice = null;
      }
      return;
    }

    // Seeing an opponent bearing down, a player gets rid of it early rather than wait to steady.
    const hurried = !ph.protectedPossession && this.t - ph.decidedAt >= 0.15 && this.nearestOpponentDistance(c) < 4.5;
    if ((this.t >= ph.executeAt || hurried) && ph.exec) {
      const q = await ph.exec.poll(this.t, Math.max(0, ph.executeAt - ph.exec.startedAt) + 0.8, this.unpaced);
      if (q) this.executeDisposal(ph, ph.choice, hurried && this.t < ph.executeAt ? q.quality * 0.85 : q.quality);
    }
  }

  private setCarrierMovement(ph: PossessionPhase, overrides: Map<SimPlayer, MoveTarget>, goal: Vec2) {
    const c = ph.carrier;
    if (ph.protectedPossession && ph.markSpot) {
      // Kicker goes back behind the mark; an opponent stands the mark.
      const settingUp = ph.choice === "shootForGoal";
      const back = unit(goal, ph.markSpot);
      const spot = clampInside({ x: ph.markSpot.x + back.x * (settingUp ? 5 : 1.5), y: ph.markSpot.y + back.y * (settingUp ? 5 : 1.5) }, 1);
      overrides.set(c, { pos: spot, sprint: false });
      if (ph.manOnMark) overrides.set(ph.manOnMark, { pos: ph.markSpot, sprint: true });
      return;
    }

    if (ph.running) {
      let heading = unit(c.pos, goal);
      const threat = this.nearestTo(this.opponentsOf(c.team), c.pos);
      if (threat && dist(threat.pos, c.pos) < 8) {
        // Swerve away from the nearest chaser while still heading for goal.
        const away = unit(threat.pos, c.pos);
        heading = unit({ x: 0, y: 0 }, { x: heading.x + away.x * 0.9, y: heading.y + away.y * 0.9 });
      }
      overrides.set(c, { pos: clampInside({ x: c.pos.x + heading.x * 10, y: c.pos.y + heading.y * 10 }, 5), sprint: true });

      ph.runDistance += dist(c.pos, ph.lastPos);
      if (ph.runDistance >= 15) {
        ph.runDistance -= 15;
        this.emit({ kind: "bounce", playerId: c.player.id });
      }
    } else {
      const heading = unit(c.pos, goal);
      overrides.set(c, { pos: clampInside({ x: c.pos.x + heading.x * 3, y: c.pos.y + heading.y * 3 }, 5), sprint: false });
    }
    ph.lastPos = { ...c.pos };
  }

  /** Returns true if a tackle ended this possession. */
  private checkTackle(ph: PossessionPhase): boolean {
    const c = ph.carrier;
    const tackler = this.opponentsOf(c.team).find(
      (o) => o.stunnedUntil <= this.t && o.tackleCooldownUntil <= this.t && dist(o.pos, c.pos) < 1.1,
    );
    if (!tackler) return false;
    tackler.tackleCooldownUntil = this.t + 2;

    if (Math.random() < 0.03) {
      this.emit({ kind: "freeKick", playerId: c.player.id, teamId: this.teamIds[c.team], reason: "high tackle" });
      this.startPossession(c, { protectedPossession: true, markSpot: { ...c.pos } });
      return true;
    }

    const a = norm(tackler.player.attributes.tackling) + 0.3;
    const d = norm(c.player.attributes.speed) * 0.55 + norm(c.player.attributes.decisionMaking) * 0.25;
    const sticks = Math.random() < a / (a + d);
    const teamId = this.teamIds[tackler.team];

    if (!sticks) {
      this.emit({ kind: "tackle", playerId: tackler.player.id, teamId, opponentId: c.player.id, outcome: "broken" });
      tackler.stunnedUntil = this.t + 1;
      ph.priorOpportunity = true;
      return false;
    }

    const prior = ph.priorOpportunity || this.t - ph.since > 1.8;
    const r = Math.random();
    let outcome: TackleOutcome = prior
      ? r < 0.4
        ? "holdingTheBall"
        : r < 0.75
          ? "handballOut"
          : "ballUp"
      : r < 0.45
        ? "handballOut"
        : r < 0.7
          ? "ballUp"
          : "dispossessed";
    const outlet = this.pickPassTarget(c, "handball");
    if (outcome === "handballOut" && !outlet) outcome = "ballUp";

    this.emit({ kind: "tackle", playerId: tackler.player.id, teamId, opponentId: c.player.id, outcome });

    switch (outcome) {
      case "holdingTheBall":
        c.stunnedUntil = this.t + 1.5;
        this.emit({ kind: "freeKick", playerId: tackler.player.id, teamId, reason: "holding the ball" });
        this.startPossession(tackler, { protectedPossession: true, markSpot: { ...tackler.pos } });
        break;
      case "handballOut":
        c.stunnedUntil = this.t + 0.8;
        this.executeDisposal(ph, "handball", 0.25 + Math.random() * 0.3, outlet!);
        break;
      case "ballUp":
        c.stunnedUntil = this.t + 0.6;
        tackler.stunnedUntil = this.t + 0.6;
        this.startStoppage("ballUp", c.pos);
        break;
      case "dispossessed": {
        c.stunnedUntil = this.t + 1;
        const spill = unit({ x: 0, y: 0 }, { x: randomJitter(1), y: randomJitter(1) });
        Object.assign(this.ball, { vx: spill.x * 3, vy: spill.y * 3, vz: 1, z: 0.8, state: "ground" as const });
        this.ball.lastTouchTeam = c.team;
        this.phase = { kind: "loose", since: this.t, congestionSince: null };
        break;
      }
    }
    return true;
  }

  /** Picks who to aim at: open teammates, further downfield, at a sensible distance for the disposal type. */
  private pickPassTarget(c: SimPlayer, choice: DisposalChoice): SimPlayer | null {
    const dir = this.attackDir(c.team);
    const range = kickRange(c.player.attributes.kicking);
    const scored: { p: SimPlayer; score: number }[] = [];
    for (const m of this.teams[c.team]) {
      if (m === c || m.stunnedUntil > this.t) continue;
      const d = dist(m.pos, c.pos);
      const ahead = (m.pos.x - c.pos.x) * dir;
      const open = Math.min(10, this.nearestOpponentDistance(m));
      const leading = m.leadTarget && this.t < m.leadUntil ? 3 : 0;
      let score: number | null = null;
      // Short kicks only go to someone genuinely free; long kicks can go to a contest but still favour space.
      if (choice === "handball" && d >= 2 && d <= 16) score = open * 1.2 - Math.abs(d - 8) * 0.3 + ahead * 0.15;
      else if (choice === "kickShort" && d >= 15 && d <= Math.min(45, range) && open >= 3) score = open * 1.5 + ahead * 0.35 - Math.abs(d - 28) * 0.1 + leading;
      else if (choice === "kickLong" && d >= 30 && d <= range && ahead > 15) score = ahead * 0.4 + open * 1.0 + leading;
      if (score !== null) scored.push({ p: m, score });
    }
    scored.sort((x, y) => y.score - x.score);
    const top = scored.slice(0, 2);
    return top.length ? top[Math.floor(Math.random() * top.length)].p : null;
  }

  private executeDisposal(ph: PossessionPhase, choice: DisposalChoice, quality: number, forcedTarget?: SimPlayer) {
    const c = ph.carrier;
    const dir = this.attackDir(c.team);
    const from = { x: c.pos.x, y: c.pos.y };
    const nearestOpp = this.nearestOpponentDistance(c);
    const pressure = ph.protectedPossession ? 0 : nearestOpp < 2 ? 0.8 : nearestOpp < 5 ? 0.4 : 0;

    let plan: FlightPlan;
    let target: SimPlayer | null = null;
    let shotDistance = 0;
    const isShot = choice === "shootForGoal";
    const type = choice === "handball" ? "handball" : "kick";

    if (isShot) {
      const shot = planShot(from, dir, quality, c.player.attributes.kicking, pressure, ph.protectedPossession);
      plan = shot;
      shotDistance = shot.distance;
    } else {
      target = forcedTarget ?? this.pickPassTarget(c, choice);
      let aim: Vec2;
      if (target) {
        // Lead the receiver: kick to where they're running, not where they are.
        const lead = type === "kick" ? (0.55 + dist(from, target.pos) / 21) * 0.7 : 0.2;
        aim = { x: target.pos.x + target.vel.x * lead, y: target.pos.y + target.vel.y * lead };
      } else {
        const len = choice === "handball" ? 8 : choice === "kickShort" ? 30 : 50;
        aim = clampInside({ x: from.x + dir * len, y: from.y * 0.8 }, 5);
      }
      plan = planPass(from, aim, type, quality, c.player.attributes.kicking);
    }

    const distance = dist(from, plan.to);
    this.emit({
      kind: "disposal",
      playerId: c.player.id,
      teamId: this.teamIds[c.team],
      type,
      intent: choice,
      targetPlayerId: target?.player.id ?? null,
      quality: Math.round(quality * 100) / 100,
      from,
      to: { x: round1(plan.to.x), y: round1(plan.to.y) },
    });
    if (type === "kick" && !isInForward50(from, dir) && isInForward50(plan.to, dir)) {
      this.emit({ kind: "insideFifty", playerId: c.player.id, teamId: this.teamIds[c.team] });
    }
    if (this.pendingClearance) {
      this.emit({ kind: "clearance", playerId: c.player.id, teamId: this.teamIds[c.team] });
      this.pendingClearance = false;
    }

    this.ball.state = "flight";
    this.ball.lastTouchTeam = c.team;
    this.ball.lastKicker = type === "kick" ? c : null;
    this.ball.untouchedSinceKick = type === "kick";
    this.ball.vx = (plan.to.x - from.x) / plan.T;
    this.ball.vy = (plan.to.y - from.y) / plan.T;
    c.stunnedUntil = this.t + 0.3;

    const predictedDefender = type === "kick" ? this.nearestTo(this.opponentsOf(c.team), plan.to) : null;
    let markDecision: AsyncDecision<Outcome> | null = null;
    if (target && predictedDefender && type === "kick" && dist(predictedDefender.pos, plan.to) < 15) {
      // Ask Jev about the likely marking contest while the ball is still in the air.
      const ctx = { kind: "mark" as const, attackerAttributes: target.player.attributes, defenderAttributes: predictedDefender.player.attributes };
      markDecision = new AsyncDecision(this.opts.decisionEngine.decideContest(ctx), () => this.local.decideContest(ctx), this.t);
    }

    this.phase = {
      kind: "flight",
      kicker: c,
      type,
      intent: choice,
      from,
      plan,
      t0: this.t,
      distance,
      quality,
      target,
      predictedDefender,
      markDecision,
      isShot,
      setShot: isShot && ph.protectedPossession,
      shotDistance,
    };
    if (this.afterSiren) this.sirenGrace = this.phase;
  }

  // --- ball in the air ---

  private async tickFlight(ph: FlightPhase, overrides: Map<SimPlayer, MoveTarget>) {
    const tau = Math.min(1, (this.t - ph.t0) / ph.plan.T);
    this.ball.x = ph.from.x + (ph.plan.to.x - ph.from.x) * tau;
    this.ball.y = ph.from.y + (ph.plan.to.y - ph.from.y) * tau;
    this.ball.z = flightHeight(ph.plan, tau);

    const land = ph.plan.to;
    if (ph.target) overrides.set(ph.target, { pos: land, sprint: true });
    if (ph.type === "kick" && (ph.intent === "kickLong" || !ph.target)) {
      // Long bombs bring players from both sides to where it'll come down, forming a marking pack.
      // Shorter kicks to a leading target are left to the target and whoever's checking them.
      const packSize = ph.distance > 40 ? 2 : 1;
      for (const team of this.teams) {
        team
          .filter((p) => p !== ph.kicker && !overrides.has(p))
          .sort((a, b) => dist(a.pos, land) - dist(b.pos, land))
          .slice(0, packSize)
          .forEach((p) => {
            if (dist(p.pos, land) < 30) overrides.set(p, { pos: land, sprint: true });
          });
      }
    }

    if (!isInsideField({ x: this.ball.x, y: this.ball.y })) {
      this.handleBallExit(ph);
      return;
    }
    if (tau >= 1) await this.resolveArrival(ph);
  }

  private async resolveArrival(ph: FlightPhase) {
    const land = ph.plan.to;
    if (ph.isShot) {
      this.emit({
        kind: "shotAtGoal",
        playerId: ph.kicker.player.id,
        teamId: this.teamIds[ph.kicker.team],
        distance: Math.round(ph.shotDistance),
        setShot: ph.setShot,
        result: "miss",
        ...this.scoreEventFields(),
      });
    }

    const radius = ph.type === "handball" ? 2.2 : 2.6;
    const near = this.players
      .filter((p) => p !== ph.kicker && p.stunnedUntil <= this.t && dist(p.pos, land) < radius)
      .sort((a, b) => dist(a.pos, land) - dist(b.pos, land));
    const a = near.find((p) => p.team === ph.kicker.team);
    // A defender has to be right there, and level with the attacker, to genuinely contest; otherwise they can only
    // intercept if nobody from the kicking side got there.
    const d = a
      ? near.find((p) => p.team !== ph.kicker.team && dist(p.pos, land) < Math.min(1.3, dist(a.pos, land) + 0.8))
      : near.find((p) => p.team !== ph.kicker.team);

    if (ph.type === "handball") {
      if (a && (!d || dist(a.pos, land) <= dist(d.pos, land))) {
        if (Math.random() < 0.9 + 0.08 * norm(a.player.attributes.handballing)) return this.startPossession(a, { protectedPossession: false });
      } else if (d) {
        return this.gather(d);
      }
      return this.dropToGround(ph, 0.2);
    }

    // A kick has to travel 15m to be a mark; shorter ones are just caught and play on.
    const markable = ph.distance >= 15;
    const catchFor = (p: SimPlayer, contested: boolean, intercept: boolean) => {
      if (!markable) return this.startPossession(p, { protectedPossession: false });
      this.emit({ kind: "mark", playerId: p.player.id, teamId: this.teamIds[p.team], contested, intercept });
      this.startPossession(p, { protectedPossession: true, markSpot: { x: land.x, y: land.y } });
    };

    if (!a && !d) return this.dropToGround(ph, 0.4);

    if (a && !d) {
      const p = 0.75 + 0.18 * norm(a.player.attributes.marking) - (ph.quality < 0.35 ? 0.15 : 0);
      if (Math.random() < p) return catchFor(a, false, false);
      this.emit({ kind: "droppedMark", playerId: a.player.id });
      return this.dropToGround(ph, 0.15);
    }

    if (d && !a) {
      if (Math.random() < 0.65 + 0.25 * norm(d.player.attributes.marking)) return catchFor(d, false, true);
      this.emit({ kind: "droppedMark", playerId: d.player.id });
      return this.dropToGround(ph, 0.15);
    }

    if (!a || !d) return;

    // Genuine one-on-one (or pack) marking contest. Packs of three or more are chaotic: the ball usually spills.
    const packFactor = near.filter((p) => dist(p.pos, land) < 2).length >= 3 ? 0.5 : 1;
    if (markable && Math.random() < 0.06) {
      // Umpire pays a free in the marking contest — usually in the back or holding against the defender.
      const toAttacker = Math.random() < 0.7;
      const receiver = toAttacker ? a : d;
      this.emit({
        kind: "freeKick",
        playerId: receiver.player.id,
        teamId: this.teamIds[receiver.team],
        reason: toAttacker ? "in the back" : "holding the man",
      });
      return this.startPossession(receiver, { protectedPossession: true, markSpot: { x: land.x, y: land.y } });
    }

    let outcome: Outcome | undefined;
    if (ph.markDecision && a === ph.target && d === ph.predictedDefender) {
      outcome = await ph.markDecision.poll(this.t, 0, this.unpaced);
    }
    outcome ??= await this.local.decideContest({ kind: "mark", attackerAttributes: a.player.attributes, defenderAttributes: d.player.attributes });

    if (outcome.success) {
      // Winning the contest means getting hands to it; holding a contested mark under a body is another matter.
      if (Math.random() < (0.3 + 0.25 * norm(a.player.attributes.marking)) * packFactor) return catchFor(a, true, false);
      this.emit({ kind: "droppedMark", playerId: a.player.id });
      return this.dropToGround(ph, 0.1);
    }
    // Defenders mostly just need to spoil; taking it cleanly is a bonus.
    const r = Math.random();
    if (r < 0.75) {
      this.emit({ kind: "spoil", playerId: d.player.id, opponentId: a.player.id });
      const punch = unit({ x: 0, y: 0 }, { x: randomJitter(1), y: randomJitter(1) });
      const speed = 5 + Math.random() * 4;
      Object.assign(this.ball, { vx: punch.x * speed, vy: punch.y * speed, vz: 1.5, state: "ground" as const });
      this.ball.lastTouchTeam = d.team;
      this.ball.untouchedSinceKick = false;
      this.phase = { kind: "loose", since: this.t, congestionSince: null };
      return;
    }
    if (r < 0.8 + 0.1 * packFactor) return catchFor(d, true, true);
    this.emit({ kind: "droppedMark", playerId: a.player.id });
    this.dropToGround(ph, 0.1);
  }

  private dropToGround(ph: FlightPhase, carry: number) {
    this.ball.vx = ((ph.plan.to.x - ph.from.x) / ph.plan.T) * carry;
    this.ball.vy = ((ph.plan.to.y - ph.from.y) / ph.plan.T) * carry;
    this.ball.vz = -3;
    this.ball.state = "ground";
    this.phase = { kind: "loose", since: this.t, congestionSince: null };
  }

  // --- ball on the ground ---

  private tickLoose(ph: LoosePhase) {
    const b = this.ball;
    b.vz -= GRAVITY * DT;
    b.z += b.vz * DT;
    if (b.z <= 0.25) {
      b.z = 0.25;
      if (Math.abs(b.vz) > 1.2) {
        // The oval ball kicks off at odd angles when it bounces.
        b.vz = -b.vz * 0.45;
        const turn = randomJitter(0.7);
        const vx = b.vx * Math.cos(turn) - b.vy * Math.sin(turn);
        b.vy = b.vx * Math.sin(turn) + b.vy * Math.cos(turn);
        b.vx = vx;
      } else {
        b.vz = 0;
      }
      b.vx *= 1 - 1.4 * DT;
      b.vy *= 1 - 1.4 * DT;
    }
    b.x += b.vx * DT;
    b.y += b.vy * DT;

    if (!isInsideField({ x: b.x, y: b.y })) {
      this.handleBallExit(null);
      return;
    }

    const ballPos = { x: b.x, y: b.y };
    if (b.z < 1.3) {
      const candidates = this.players
        .filter((p) => p.stunnedUntil <= this.t && p.pickupCooldownUntil <= this.t && dist(p.pos, ballPos) < 1.3)
        .sort((x, y) => dist(x.pos, ballPos) - dist(y.pos, ballPos));
      const first = candidates[0];
      if (first) {
        const rival = this.players.find((p) => p.team !== first.team && p.stunnedUntil <= this.t && dist(p.pos, ballPos) < 1.8);
        let winner = first;
        if (rival) {
          const fa = norm(first.player.attributes.speed) + norm(first.player.attributes.handballing) + 0.3;
          const ra = norm(rival.player.attributes.speed) + norm(rival.player.attributes.handballing) + 0.3;
          winner = Math.random() < fa / (fa + ra) ? first : rival;
        }
        const clean = 0.65 + 0.3 * norm((winner.player.attributes.handballing + winner.player.attributes.decisionMaking) / 2) - (rival ? 0.15 : 0);
        if (Math.random() < clean) {
          this.gather(winner);
          return;
        }
        // Fumbled — knocked on a little way.
        winner.pickupCooldownUntil = this.t + 0.6;
        const knock = unit({ x: 0, y: 0 }, { x: randomJitter(1), y: randomJitter(1) });
        b.vx = knock.x * (2 + Math.random() * 2);
        b.vy = knock.y * (2 + Math.random() * 2);
        b.lastTouchTeam = winner.team;
        b.untouchedSinceKick = false;
      }
    }

    // Umpire calls a ball-up when a pack forms and nobody can get it out, or it's been loose too long.
    const packed = ([0, 1] as const).every((team) => this.teams[team].filter((p) => dist(p.pos, ballPos) < 4).length >= 2);
    if (packed) ph.congestionSince ??= this.t;
    else ph.congestionSince = null;
    if ((ph.congestionSince !== null && this.t - ph.congestionSince >= 2.5) || this.t - ph.since > 10) {
      this.startStoppage("ballUp", ballPos);
    }
  }

  private gather(p: SimPlayer) {
    this.emit({ kind: "gather", playerId: p.player.id, teamId: this.teamIds[p.team], fromOpposition: p.team !== this.ball.lastTouchTeam });
    this.startPossession(p, { protectedPossession: false });
  }

  // --- ball leaving the ground ---

  private handleBallExit(flight: FlightPhase | null) {
    const b = this.ball;
    const exit = classifyExit({ x: b.x, y: b.y });

    if (exit.kind === "scoringLine") {
      const scoringTeam: 0 | 1 = this.attackDir(0) === exit.end ? 0 : 1;
      const kicker = b.lastKicker;
      const kickedThrough = kicker !== null && kicker.team === scoringTeam && (flight !== null || b.untouchedSinceKick);
      const s = this.score[scoringTeam];

      if (kickedThrough) {
        const hitPost = Math.abs(exit.y) > GOAL_HALF_WIDTH - 0.3 && Math.abs(exit.y) < GOAL_HALF_WIDTH + 0.3 && Math.random() < 0.3;
        const goal = Math.abs(exit.y) <= GOAL_HALF_WIDTH && !hitPost;
        if (goal) s.goals++;
        else s.behinds++;
        this.emit({
          kind: "shotAtGoal",
          playerId: kicker.player.id,
          teamId: this.teamIds[scoringTeam],
          distance: Math.round(flight?.shotDistance || distanceToGoal(flight?.from ?? kicker.pos, exit.end)),
          setShot: flight?.setShot ?? false,
          result: goal ? "goal" : "behind",
          ...this.scoreEventFields(),
        });
        if (goal) return this.afterGoal();
      } else {
        s.behinds++;
        this.emit({ kind: "rushedBehind", teamId: this.teamIds[scoringTeam], ...this.scoreEventFields() });
      }
      return this.afterBehind(scoringTeam === 0 ? 1 : 0);
    }

    const spot = clampInside(exit.at, 3);
    const lastTeam = b.lastTouchTeam;
    const onTheFull = flight !== null && flight.type === "kick";
    this.emit({ kind: "outOfBounds", onTheFull, lastTeamId: this.teamIds[lastTeam] });

    if (onTheFull) {
      if (flight.isShot) {
        this.emit({
          kind: "shotAtGoal",
          playerId: flight.kicker.player.id,
          teamId: this.teamIds[flight.kicker.team],
          distance: Math.round(flight.shotDistance),
          setShot: flight.setShot,
          result: "miss",
          ...this.scoreEventFields(),
        });
      }
      const taker = this.nearestTo(this.opponentsOf(lastTeam), spot) ?? this.opponentsOf(lastTeam)[0];
      this.placeBall(spot, 0.5);
      this.phase = {
        kind: "dead",
        until: this.t + 4,
        targets: new Map([[taker, { pos: spot, sprint: true }]]),
        next: () => {
          this.emit({ kind: "freeKick", playerId: taker.player.id, teamId: this.teamIds[taker.team], reason: "out on the full" });
          taker.pos = { ...spot };
          this.startPossession(taker, { protectedPossession: true, markSpot: spot });
        },
      };
      return;
    }

    this.placeBall(spot, 0.5);
    this.phase = { kind: "dead", until: this.t + 4, targets: new Map(), next: () => this.startStoppage("throwIn", spot) };
  }

  private afterGoal() {
    // The ball sits behind the goals during the celebration, then goes back to the centre in a long lob
    // rather than vanishing and reappearing there.
    const from = { x: this.ball.x, y: this.ball.y };
    const scoredAt = this.t;
    this.placeBall(from, 0.3);
    const targets = new Map<SimPlayer, MoveTarget>();
    for (const p of this.players) targets.set(p, { pos: slotWorld(p.slot, this.attackDir(p.team)), sprint: false });
    this.phase = {
      kind: "dead",
      until: this.t + 14,
      targets,
      next: () => this.startCentreBounce(),
      tick: () => {
        const tau = Math.min(1, Math.max(0, (this.t - scoredAt - 4) / 5));
        if (tau === 0) return;
        this.ball.x = from.x * (1 - tau);
        this.ball.y = from.y * (1 - tau);
        this.ball.z = 0.3 + 0.9 * tau + 4 * 14 * tau * (1 - tau);
      },
    };
  }

  private afterBehind(defendingTeam: 0 | 1) {
    const ownEnd = (this.attackDir(defendingTeam) * -1) as 1 | -1;
    const spot = { x: ownEnd * 84, y: 0 };
    this.placeBall(spot, 0.5);
    const kicker =
      this.teams[defendingTeam].find((p) => p.slot.name === "Full back") ??
      this.nearestTo(this.teams[defendingTeam], spot) ??
      this.teams[defendingTeam][0];
    this.phase = {
      kind: "dead",
      until: this.t + 7,
      targets: new Map([[kicker, { pos: spot, sprint: true }]]),
      next: () => {
        kicker.pos = { ...spot };
        this.emit({ kind: "kickIn", teamId: this.teamIds[defendingTeam], playerId: kicker.player.id });
        this.startPossession(kicker, { protectedPossession: true, markSpot: spot, kickIn: true });
      },
    };
  }
}

/** Runs an entire AFL match start-to-finish as a physics simulation, yielding MatchEvents and frames as it unfolds. */
export async function* simulateMatch(opts: MatchSimOptions): AsyncGenerator<MatchEvent, void, void> {
  const simSpeed = opts.simSpeed ?? config.simSpeed;
  const unpaced = simSpeed >= UNPACED_SPEED;
  const sim = new MatchSim(opts, unpaced);
  yield sim.startEvent(simSpeed);

  let nextFrameAt = 0;
  let realOrigin = performance.now();
  while (!sim.finished) {
    await sim.step();
    yield* sim.drain();
    if (sim.t >= nextFrameAt) {
      nextFrameAt += FRAME_INTERVAL;
      yield { kind: "frame", frame: sim.frame() };
      if (!unpaced) {
        const wait = realOrigin + (sim.t / simSpeed) * 1000 - performance.now();
        if (wait > 0) await sleep(wait);
        // If we fell well behind (e.g. a slow decision), don't fast-forward to catch up — just carry on from here.
        else if (wait < -250) realOrigin -= wait;
      }
    }
  }
  yield* sim.drain();
  yield { kind: "frame", frame: sim.frame() };
}
