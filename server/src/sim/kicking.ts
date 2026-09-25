import { norm } from "../jev/decisionEngine.js";
import { clampInside, dist, gaussian, goalCenter, unit, type Vec2 } from "./field.js";

export interface FlightPlan {
  to: Vec2;
  /** seconds in the air */
  T: number;
  zStart: number;
  zEnd: number;
  /** extra height at the apex on top of a straight line from start to end */
  apex: number;
}

const GRAVITY = 9.8;

/**
 * Hang time for a kick or handball of a given length, from real footy: a flat 20m pass is in the air about 1.1s and a
 * 50m pass about 2.4s; a lofted 50m bomb into a contest hangs about 3.3s; a 10m handball about 0.8s.
 */
function hangTime(type: "kick" | "handball", distance: number, lofted = false): number {
  if (type === "handball") return 0.15 + distance / 15;
  return lofted ? 0.8 + distance / 20 : 0.3 + distance / 24;
}

/** How far a ball in the air for T seconds rises above the straight line between its ends, under real gravity. */
function apexFor(T: number): number {
  return (GRAVITY * T * T) / 8;
}

export function kickRange(kicking: number): number {
  return 42 + 22 * norm(kicking);
}

/** Plans a kick or handball toward `aim`, degraded by execution quality: poor disposals miss their target and fall short. */
export function planPass(from: Vec2, aim: Vec2, type: "kick" | "handball", quality: number, kicking: number, lofted = false): FlightPlan {
  const range = type === "handball" ? 20 : kickRange(kicking);
  let d = dist(from, aim);
  const u = unit(from, aim);
  if (d > range) {
    aim = { x: from.x + u.x * range, y: from.y + u.y * range };
    d = range;
  }

  const spread = type === "handball" ? (1 - quality) * 2 : (1 - quality) * (2 + 0.22 * d);
  const shortfall = type === "kick" ? (1 - quality) * 0.15 * d * Math.random() : 0;
  const to = clampInside(
    {
      x: aim.x - u.x * shortfall + gaussian() * spread * 0.6,
      y: aim.y - u.y * shortfall + gaussian() * spread * 0.6,
    },
    -6, // kicks can sail over the boundary; the engine calls it out on the full
  );
  const travelled = dist(from, to);

  const T = hangTime(type, travelled, lofted);
  if (type === "handball") {
    return { to, T, zStart: 1.0, zEnd: 1.1, apex: apexFor(T) };
  }
  return { to, T, zStart: 0.6, zEnd: 1.9, apex: apexFor(T) };
}

/**
 * Plans a shot at goal. The kicker aims at the middle; angular error grows with poor execution, pressure and
 * kicking on the run. Whether it's a goal, behind or out on the full falls out of where the ball crosses the line.
 */
export function planShot(
  from: Vec2,
  attackDir: 1 | -1,
  quality: number,
  kicking: number,
  pressure: number,
  setShot: boolean,
): FlightPlan & { distance: number } {
  const goal = goalCenter(attackDir);
  const distance = dist(from, goal);
  const aimDir = unit(from, goal);

  const sigma = (0.05 + 0.12 * (1 - quality)) * (setShot ? 1 : 1.3) * (1 + 0.6 * pressure);
  const theta = gaussian() * sigma;
  const dir = {
    x: aimDir.x * Math.cos(theta) - aimDir.y * Math.sin(theta),
    y: aimDir.x * Math.sin(theta) + aimDir.y * Math.cos(theta),
  };

  const range = kickRange(kicking) + (setShot ? 4 : 0);
  const carry = Math.min(range * (0.93 + Math.random() * 0.07), distance + 15);
  const to = { x: from.x + dir.x * carry, y: from.y + dir.y * carry };
  const clearsLine = carry >= distance;

  const T = hangTime("kick", carry);
  return { to, T, zStart: 0.6, zEnd: clearsLine ? 4 : 1.9, apex: apexFor(T), distance };
}

/** Ball height partway through a flight (0..1) — a parabola on top of a straight line between start and end heights. */
export function flightHeight(plan: Pick<FlightPlan, "zStart" | "zEnd" | "apex">, tau: number): number {
  return plan.zStart + (plan.zEnd - plan.zStart) * tau + 4 * plan.apex * tau * (1 - tau);
}
