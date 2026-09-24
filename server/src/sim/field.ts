export interface Vec2 {
  x: number;
  y: number;
}

export const FIELD_HALF_LENGTH = 90;
export const FIELD_HALF_WIDTH = 65;
export const GOAL_HALF_WIDTH = 3.2;
export const BEHIND_HALF_WIDTH = 9.6;
export const FIFTY_ARC_RADIUS = 50;

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function unit(from: Vec2, to: Vec2): Vec2 {
  const d = dist(from, to);
  return d < 1e-6 ? { x: 0, y: 0 } : { x: (to.x - from.x) / d, y: (to.y - from.y) / d };
}

export function randomJitter(range: number): number {
  return (Math.random() - 0.5) * 2 * range;
}

export function gaussian(): number {
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function goalCenter(attackDir: 1 | -1): Vec2 {
  return { x: attackDir * FIELD_HALF_LENGTH, y: 0 };
}

/** 0 at the centre of the ground, 1 on the boundary line. */
function ellipseRadius(p: Vec2): number {
  return Math.sqrt((p.x / FIELD_HALF_LENGTH) ** 2 + (p.y / FIELD_HALF_WIDTH) ** 2);
}

export function isInsideField(p: Vec2): boolean {
  return ellipseRadius(p) <= 1;
}

/** Pulls a point back inside the boundary, leaving `margin` meters of room. */
export function clampInside(p: Vec2, margin = 1): Vec2 {
  const r = ellipseRadius(p);
  const limit = 1 - margin / FIELD_HALF_WIDTH;
  if (r <= limit) return p;
  const s = limit / r;
  return { x: p.x * s, y: p.y * s };
}

export function distanceToGoal(p: Vec2, attackDir: 1 | -1): number {
  return dist(p, goalCenter(attackDir));
}

/** Angle between the line to the goal centre and the ground's long axis — 0 is dead in front. */
export function angleToGoalDeg(p: Vec2, attackDir: 1 | -1): number {
  const g = goalCenter(attackDir);
  return (Math.atan2(Math.abs(p.y - g.y), Math.max(0.01, Math.abs(g.x - p.x))) * 180) / Math.PI;
}

export function isInForward50(p: Vec2, attackDir: 1 | -1): boolean {
  return distanceToGoal(p, attackDir) <= FIFTY_ARC_RADIUS;
}

export type BoundaryCrossing =
  | { kind: "scoringLine"; end: 1 | -1; y: number }
  | { kind: "boundary"; at: Vec2 };

/** Classifies where a ball that has just left the ground went out. */
export function classifyExit(p: Vec2): BoundaryCrossing {
  if (Math.abs(p.y) <= BEHIND_HALF_WIDTH && Math.abs(p.x) > FIELD_HALF_LENGTH - 5) {
    return { kind: "scoringLine", end: p.x > 0 ? 1 : -1, y: p.y };
  }
  return { kind: "boundary", at: p };
}
