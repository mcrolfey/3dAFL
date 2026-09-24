import type { Player } from "@3dafl/shared";
import { norm } from "../jev/decisionEngine.js";
import type { Vec2 } from "./field.js";
import type { Slot } from "./formation.js";

export interface SimPlayer {
  /** index into the roster streamed to clients (home players first) */
  idx: number;
  player: Player;
  team: 0 | 1;
  slot: Slot;
  matchup: SimPlayer | null;
  pos: Vec2;
  vel: Vec2;
  /** 0 fresh .. 1 exhausted; slows top speed */
  fatigue: number;
  /** flat-out running speed when fresh, m/s */
  sprintSpeed: number;
  /** can't contest or pick up until this sim time (after being tackled, fumbling, etc.) */
  stunnedUntil: number;
  tackleCooldownUntil: number;
  pickupCooldownUntil: number;
  /** forwards periodically lead toward the ball carrier to present as a target */
  leadTarget: Vec2 | null;
  leadStartedAt: number;
  leadUntil: number;
  nextLeadAt: number;
}

export function createSimPlayer(idx: number, player: Player, team: 0 | 1, slot: Slot, pos: Vec2): SimPlayer {
  return {
    idx,
    player,
    team,
    slot,
    matchup: null,
    pos: { ...pos },
    vel: { x: 0, y: 0 },
    fatigue: 0,
    sprintSpeed: 6.6 + 2.4 * norm(player.attributes.speed),
    stunnedUntil: 0,
    tackleCooldownUntil: 0,
    pickupCooldownUntil: 0,
    leadTarget: null,
    leadStartedAt: 0,
    leadUntil: 0,
    nextLeadAt: Math.random() * 6,
  };
}

export type BallState = "held" | "flight" | "ground" | "dead";

export interface SimBall {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  state: BallState;
  lastTouchTeam: 0 | 1;
  /** the last player to kick it, and whether anyone has touched it since — decides goals from bouncing kicks */
  lastKicker: SimPlayer | null;
  untouchedSinceKick: boolean;
}

/**
 * A decision (usually a Jev network call) that runs while the simulation keeps ticking. Players keep moving
 * while it's in flight; if it takes too long in sim time, the local fallback answers instead.
 */
export class AsyncDecision<T> {
  private value: T | undefined;
  private done = false;

  constructor(
    private readonly promise: Promise<T>,
    private readonly fallback: () => Promise<T>,
    readonly startedAt: number,
  ) {
    promise.then(
      (v) => {
        if (!this.done) {
          this.value = v;
          this.done = true;
        }
      },
      () => {},
    );
  }

  /** The answer if available. Unpaced (headless) runs just wait for it, since no real time passes between ticks. */
  async poll(now: number, maxWaitSim: number, unpaced: boolean): Promise<T | undefined> {
    if (this.done) return this.value;
    if (unpaced) {
      try {
        this.value = await this.promise;
      } catch {
        this.value = await this.fallback();
      }
      this.done = true;
      return this.value;
    }
    if (now - this.startedAt >= maxWaitSim) {
      this.value = await this.fallback();
      this.done = true;
      return this.value;
    }
    return undefined;
  }
}
