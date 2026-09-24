import { norm } from "../jev/decisionEngine.js";
import { clampInside, dist, goalCenter, unit, type Vec2 } from "./field.js";
import { slotWorld } from "./formation.js";
import type { SimPlayer } from "./state.js";

export interface MoveTarget {
  pos: Vec2;
  sprint: boolean;
}

export type MoveMode = "possession" | "protected" | "flight" | "loose" | "stoppage" | "dead";

export interface MoveContext {
  t: number;
  mode: MoveMode;
  /** where the play is: the ball, or where it's going to land */
  focus: Vec2;
  focusVel: Vec2;
  /** team that has (or last had) the ball, which pushes up while the other drops back */
  possTeam: 0 | 1 | null;
  carrier: SimPlayer | null;
  attackDirOf: (team: 0 | 1) => 1 | -1;
  /** phase-specific instructions (ball carrier, runners to a kick's landing spot, stoppage setups) */
  overrides: Map<SimPlayer, MoveTarget>;
}

const ACCEL = 7;
const MIN_SEPARATION = 0.9;

function nearest(players: SimPlayer[], to: Vec2, count: number, t: number): SimPlayer[] {
  return players
    .filter((p) => p.stunnedUntil <= t)
    .sort((a, b) => dist(a.pos, to) - dist(b.pos, to))
    .slice(0, count);
}

/** Where a player would stand given their named position, shifted with the ball like a real team shape. */
export function zonePosition(p: SimPlayer, ctx: MoveContext): Vec2 {
  const dir = ctx.attackDirOf(p.team);
  const base = slotWorld(p.slot, dir);
  const push = ctx.possTeam === null ? 0 : ctx.possTeam === p.team ? 8 : -6;
  const x = base.x * 0.75 + ctx.focus.x * 0.45 + push * dir;
  let y = base.y * 0.85 + ctx.focus.y * 0.35;
  let zx = x;
  if (p.slot.line === "centre" && p.slot.name !== "Wing") {
    // Onballers play closer to the footy than anyone else.
    zx = x * 0.65 + ctx.focus.x * 0.35;
    y = y * 0.65 + ctx.focus.y * 0.35;
  }
  return clampInside({ x: zx, y }, 3);
}

function defendingPosition(p: SimPlayer, ctx: MoveContext, zone: Vec2): MoveTarget {
  const opp = p.matchup;
  if (!opp) return { pos: zone, sprint: false };
  // A forward who breaks into a lead gets a jump on their defender, who's caught flat-footed for a moment.
  if (opp.leadTarget && ctx.t < opp.leadUntil && ctx.t - opp.leadStartedAt < 0.7) return { pos: p.pos, sprint: false };
  const ownGoal = goalCenter((ctx.attackDirOf(p.team) * -1) as 1 | -1);
  // With the ball deep in your own end, defenders play right on their forward; elsewhere teams mostly zone off,
  // leaving the key-position matchups as the only true man-on-man.
  const deep = dist(ctx.focus, ownGoal) < 55;
  const keyPosition = /Full|pocket|Centre half/i.test(p.slot.name);
  const goalSide = unit(opp.pos, ownGoal);
  const gap = deep ? 1.2 : 2.5;
  const manPos = { x: opp.pos.x + goalSide.x * gap, y: opp.pos.y + goalSide.y * gap };
  const oppToBall = dist(opp.pos, ctx.focus);
  const tightness = oppToBall < 35 ? (deep ? 0.95 : keyPosition ? 0.75 : 0.5) : oppToBall < 60 ? 0.45 : 0.3;
  const pos = clampInside({ x: zone.x + (manPos.x - zone.x) * tightness, y: zone.y + (manPos.y - zone.y) * tightness }, 2);
  return { pos, sprint: oppToBall < 40 && dist(p.pos, pos) > 5 };
}

function leadingPosition(p: SimPlayer, ctx: MoveContext, zone: Vec2): MoveTarget {
  const carrier = ctx.carrier;
  if (p.leadTarget && ctx.t < p.leadUntil) return { pos: p.leadTarget, sprint: true };
  if (carrier && ctx.t >= p.nextLeadAt && dist(p.pos, carrier.pos) < 75) {
    const toward = unit(p.pos, carrier.pos);
    const len = 12 + Math.random() * 10;
    p.leadTarget = clampInside({ x: p.pos.x + toward.x * len, y: p.pos.y + toward.y * len + (Math.random() - 0.5) * 10 }, 3);
    p.leadStartedAt = ctx.t;
    p.leadUntil = ctx.t + 2 + Math.random() * 1.5;
    p.nextLeadAt = ctx.t + 5 + Math.random() * 6;
    return { pos: p.leadTarget, sprint: true };
  }
  p.leadTarget = null;
  return { pos: zone, sprint: dist(p.pos, zone) > 15 };
}

/** Decides where every player is trying to get to this tick. */
export function planMovement(players: SimPlayer[], ctx: MoveContext): Map<SimPlayer, MoveTarget> {
  const targets = new Map<SimPlayer, MoveTarget>(ctx.overrides);
  const teams: [SimPlayer[], SimPlayer[]] = [players.filter((p) => p.team === 0), players.filter((p) => p.team === 1)];

  const chaseTarget: Vec2 = { x: ctx.focus.x + ctx.focusVel.x * 0.4, y: ctx.focus.y + ctx.focusVel.y * 0.4 };
  if (ctx.mode === "possession" && ctx.carrier) {
    const opponents = teams[ctx.carrier.team === 0 ? 1 : 0].filter((p) => !targets.has(p));
    // The nearest opponent closes down the ball carrier; a second only joins if they're right there.
    const [first, second] = nearest(opponents, ctx.carrier.pos, 2, ctx.t);
    if (first && dist(first.pos, ctx.carrier.pos) < 15) targets.set(first, { pos: chaseTarget, sprint: true });
    if (second && dist(second.pos, ctx.carrier.pos) < 8) targets.set(second, { pos: chaseTarget, sprint: true });

    // Two nearby teammates run past/around for a handball receive.
    const dir = ctx.attackDirOf(ctx.carrier.team);
    const mates = teams[ctx.carrier.team].filter((p) => p !== ctx.carrier && !targets.has(p) && dist(p.pos, ctx.carrier!.pos) < 30);
    nearest(mates, ctx.carrier.pos, 2, ctx.t).forEach((mate, i) => {
      const side = Math.sign(mate.pos.y - ctx.carrier!.pos.y) || 1;
      const pos =
        i === 0
          ? { x: ctx.carrier!.pos.x + dir * 6, y: ctx.carrier!.pos.y + side * 8 }
          : { x: ctx.carrier!.pos.x - dir * 3, y: ctx.carrier!.pos.y + side * 6 };
      targets.set(mate, { pos: clampInside(pos, 3), sprint: true });
    });
  } else if (ctx.mode === "loose") {
    for (const team of teams) {
      for (const p of nearest(team.filter((q) => !targets.has(q)), ctx.focus, 2, ctx.t)) {
        targets.set(p, { pos: chaseTarget, sprint: true });
      }
    }
  }

  // Defending deep, the Centre and a Wing drop back unmarked into "the hole" in front of goal to intercept entries.
  if (ctx.possTeam !== null && ctx.mode !== "stoppage" && ctx.mode !== "dead") {
    const defending = (ctx.possTeam === 0 ? 1 : 0) as 0 | 1;
    const ownGoal = goalCenter((ctx.attackDirOf(defending) * -1) as 1 | -1);
    if (dist(ctx.focus, ownGoal) < 80) {
      const toBall = unit(ownGoal, ctx.focus);
      const spares = teams[defending].filter((p) => !targets.has(p) && (p.slot.name === "Centre" || (p.slot.name === "Wing" && p.slot.y * ctx.focus.y <= 0)));
      spares.forEach((p, i) => {
        const depth = i === 0 ? 24 : 34;
        const pos = clampInside({ x: ownGoal.x + toBall.x * depth - toBall.y * (i === 0 ? 0 : 8), y: ownGoal.y + toBall.y * depth + toBall.x * (i === 0 ? 0 : 8) }, 2);
        targets.set(p, { pos, sprint: dist(p.pos, pos) > 10 });
      });
    }
  }

  for (const p of players) {
    if (targets.has(p)) continue;
    const zone = zonePosition(p, ctx);
    if (ctx.mode === "stoppage" || ctx.mode === "dead" || ctx.possTeam === null) {
      targets.set(p, { pos: zone, sprint: false });
    } else if (ctx.possTeam !== p.team) {
      targets.set(p, defendingPosition(p, ctx, zone));
    } else if (p.slot.line === "forward" && ctx.mode === "possession") {
      targets.set(p, leadingPosition(p, ctx, zone));
    } else {
      targets.set(p, { pos: zone, sprint: dist(p.pos, zone) > 15 });
    }
  }
  return targets;
}

/** Moves every player toward their target with acceleration limits, fatigue, and simple collision separation. */
export function integrate(players: SimPlayer[], targets: Map<SimPlayer, MoveTarget>, dt: number, t: number, carrier: SimPlayer | null) {
  for (const p of players) {
    const target = targets.get(p);
    let desiredX = 0;
    let desiredY = 0;
    if (target && p.stunnedUntil <= t) {
      const topSpeed = target.sprint ? p.sprintSpeed * (1 - 0.22 * p.fatigue) : p.sprintSpeed * 0.5;
      const maxSpeed = p === carrier ? topSpeed * 0.92 : topSpeed;
      const dx = target.pos.x - p.pos.x;
      const dy = target.pos.y - p.pos.y;
      const d = Math.hypot(dx, dy);
      if (d > 0.25) {
        const speed = Math.min(maxSpeed, d * 1.6);
        desiredX = (dx / d) * speed;
        desiredY = (dy / d) * speed;
      }
    }

    let dvx = desiredX - p.vel.x;
    let dvy = desiredY - p.vel.y;
    const dv = Math.hypot(dvx, dvy);
    const maxDv = ACCEL * dt;
    if (dv > maxDv) {
      dvx = (dvx / dv) * maxDv;
      dvy = (dvy / dv) * maxDv;
    }
    p.vel.x += dvx;
    p.vel.y += dvy;
    p.pos.x += p.vel.x * dt;
    p.pos.y += p.vel.y * dt;

    const speed = Math.hypot(p.vel.x, p.vel.y);
    const endurance = norm(p.player.attributes.endurance);
    p.fatigue += speed > p.sprintSpeed * 0.7 ? dt * 0.0035 * (1.6 - endurance) : -dt * 0.0012;
    p.fatigue = Math.max(0, Math.min(1, p.fatigue));
  }

  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i];
      const b = players[j];
      const dx = b.pos.x - a.pos.x;
      const dy = b.pos.y - a.pos.y;
      const d = Math.hypot(dx, dy);
      if (d < MIN_SEPARATION && d > 1e-4) {
        const push = (MIN_SEPARATION - d) / 2;
        a.pos.x -= (dx / d) * push;
        a.pos.y -= (dy / d) * push;
        b.pos.x += (dx / d) * push;
        b.pos.y += (dy / d) * push;
      }
    }
  }

  for (const p of players) {
    const inside = clampInside(p.pos, 0.3);
    p.pos.x = inside.x;
    p.pos.y = inside.y;
  }
}
