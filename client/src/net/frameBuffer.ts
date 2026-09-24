import type { MatchFrame } from "@3dafl/shared";

interface Stamped {
  at: number;
  frame: MatchFrame;
}

export interface SampledFrame {
  /** nearest real frame, for discrete data like the clock and who has the ball */
  frame: MatchFrame;
  /** interpolated flat [x, y, ...] player positions */
  players: Float32Array;
  /** interpolated ball x, y, height */
  ball: [number, number, number];
}

/**
 * Buffers the server's physics frames and plays them back a fraction of a second behind real time, interpolating
 * between neighbouring frames so movement stays smooth regardless of network timing.
 */
export class FrameBuffer {
  private frames: Stamped[] = [];
  private delayMs = 160;

  configure(frameIntervalSim: number, simSpeed: number) {
    const realIntervalMs = (frameIntervalSim / simSpeed) * 1000;
    this.delayMs = Math.max(80, realIntervalMs * 2.5);
  }

  reset() {
    this.frames = [];
  }

  push(frame: MatchFrame) {
    this.frames.push({ at: performance.now(), frame });
    if (this.frames.length > 240) this.frames.splice(0, this.frames.length - 240);
  }

  sample(now: number): SampledFrame | null {
    if (this.frames.length === 0) return null;
    const renderAt = now - this.delayMs;
    let i = this.frames.length - 1;
    while (i > 0 && this.frames[i].at > renderAt) i--;
    const a = this.frames[i];
    const b = this.frames[Math.min(i + 1, this.frames.length - 1)];
    const span = b.at - a.at;
    const k = span > 0 ? Math.min(1, Math.max(0, (renderAt - a.at) / span)) : 0;

    const players = new Float32Array(a.frame.players.length);
    for (let j = 0; j < players.length; j++) players[j] = a.frame.players[j] + (b.frame.players[j] - a.frame.players[j]) * k;
    const ball: [number, number, number] = [0, 0, 0];
    for (let j = 0; j < 3; j++) ball[j] = a.frame.ball[j] + (b.frame.ball[j] - a.frame.ball[j]) * k;

    return { frame: k < 0.5 ? a.frame : b.frame, players, ball };
  }
}
