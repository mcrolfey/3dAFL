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

export function kickRange(kicking: number): number {
  return 42 + 22 * norm(kicking);
}

/** Plans a kick or handball toward `aim`, degraded by execution quality: poor disposals miss their target and fall short. */
export function planPass(from: Vec2, aim: Vec2, type: "kick" | "handball", quality: number, kicking: number): FlightPlan {
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

  if (type === "handball") {
    return { to, T: 0.25 + travelled / 14, zStart: 1.0, zEnd: 1.1, apex: 0.6 };
  }
  return { to, T: 0.55 + travelled / 21, zStart: 0.6, zEnd: 1.9, apex: 0.14 * travelled };
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

  const sigma = (0.06 + 0.14 * (1 - quality)) * (setShot ? 1 : 1.35) * (1 + 0.6 * pressure);
  const theta = gaussian() * sigma;
  const dir = {
    x: aimDir.x * Math.cos(theta) - aimDir.y * Math.sin(theta),
    y: aimDir.x * Math.sin(theta) + aimDir.y * Math.cos(theta),
  };

  const range = kickRange(kicking) + (setShot ? 4 : 0);
  const carry = Math.min(range * (0.93 + Math.random() * 0.07), distance + 15);
  const to = { x: from.x + dir.x * carry, y: from.y + dir.y * carry };
  const clearsLine = carry >= distance;

  return { to, T: 0.55 + carry / 21, zStart: 0.6, zEnd: clearsLine ? 4 : 1.9, apex: 0.14 * carry, distance };
}

/** Ball height partway through a flight (0..1) — a parabola on top of a straight line between start and end heights. */
export function flightHeight(plan: Pick<FlightPlan, "zStart" | "zEnd" | "apex">, tau: number): number {
  return plan.zStart + (plan.zEnd - plan.zStart) * tau + 4 * plan.apex * tau * (1 - tau);
}
