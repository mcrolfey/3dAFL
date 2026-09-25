import * as THREE from "three";
import type { FieldPos, MatchEvent } from "@3dafl/shared";
import type { SampledFrame } from "../net/frameBuffer.js";
import type { AudioEngine, Placement } from "./audioEngine.js";
import type { Voices } from "./voices.js";

function pick<T>(options: T[]): T {
  return options[Math.floor(Math.random() * options.length)];
}

const GOAL_X = 90;

/** Turns match events and physics frames into crowd reactions, umpire whistles, ball sounds and on-field calls. */
export class MatchAudio {
  private excitement = 0.2;
  private boost = 0;
  private lastExcitementPush = 0;
  private homeCount = 18;
  private manOnCarrier = -1;
  private manOnArmed = false;

  constructor(
    private readonly engine: AudioEngine,
    private readonly voices: Voices,
    private readonly camera: THREE.Camera,
    private readonly ballWorld: () => THREE.Vector3,
  ) {}

  setRoster(homeCount: number) {
    this.homeCount = homeCount;
    this.excitement = 0.2;
    this.boost = 0;
  }

  /** Louder when close to the camera, panned to where it happens on screen. */
  private placeAt(world: THREE.Vector3): Placement {
    const distance = world.distanceTo(this.camera.position);
    const onScreen = world.clone().project(this.camera);
    return { volume: Math.min(1, 1.6 / (1 + distance / 30)), pan: Math.max(-1, Math.min(1, onScreen.x)) * 0.7 };
  }

  private placeField(p: FieldPos): Placement {
    return this.placeAt(new THREE.Vector3(p.x, 1, p.y));
  }

  private placeBall(): Placement {
    return this.placeAt(this.ballWorld());
  }

  private umpire(text: string) {
    this.voices.call(text, { volume: 0.75, pitch: 0.9, rate: 1.15, priority: true });
  }

  private player(text: string, place: Placement) {
    this.voices.call(text, { volume: 0.25 + 0.4 * place.volume, pitch: 0.8 + Math.random() * 0.45, rate: 1.35 });
  }

  onEvent(e: MatchEvent) {
    const sfx = this.engine;
    switch (e.kind) {
      case "stoppage":
        sfx.whistle([0.4]);
        if (e.type === "centerBounce") this.boost += 0.25;
        if (e.type === "ballUp" && Math.random() < 0.4) this.umpire("Ball up!");
        break;
      case "hitout":
        sfx.impact("handball", this.placeBall());
        break;
      case "disposal": {
        const place = this.placeField(e.from);
        sfx.impact(e.type === "kick" ? "kick" : "handball", place);
        if (e.intent === "shootForGoal") this.boost += 0.35;
        if (e.targetPlayerId && Math.random() < (e.type === "handball" ? 0.5 : 0.25)) {
          this.player(e.type === "handball" ? pick(["Yep!", "Here!", "Yes!"]) : pick(["Mine!", "Here!", "Yep!"]), place);
        }
        break;
      }
      case "mark":
        sfx.impact("mark", this.placeBall());
        if (e.contested) sfx.cheer(0.45, 3);
        else sfx.applause(0.2, 2);
        break;
      case "spoil":
        sfx.impact("tackle", this.placeBall());
        break;
      case "droppedMark":
        sfx.groan(0.45);
        break;
      case "tackle":
        sfx.impact("tackle", this.placeBall());
        if (e.outcome === "holdingTheBall") {
          sfx.ballChant();
          window.setTimeout(() => sfx.whistle([0.18, 0.18]), 400);
          window.setTimeout(() => this.umpire("Holding the ball!"), 750);
        } else if (e.outcome === "broken") {
          sfx.cheer(0.25, 2);
        }
        break;
      case "freeKick":
        if (e.reason !== "holding the ball") sfx.whistle([0.18, 0.18]);
        break;
      case "playOn":
        this.umpire("Play on!");
        break;
      case "bounce":
        sfx.impact("bounce", this.placeBall());
        sfx.cheer(0.3, 2);
        break;
      case "insideFifty":
        this.boost += 0.15;
        break;
      case "clearance":
        this.boost += 0.08;
        break;
      case "outOfBounds":
        sfx.whistle(e.onTheFull ? [0.18, 0.18] : [0.3]);
        break;
      case "shotAtGoal":
        if (e.result === "goal") {
          sfx.cheer(1, 7);
          this.boost = 0;
        } else if (e.result === "behind") {
          sfx.groan(0.55);
          sfx.applause(0.25, 2.5);
        } else {
          sfx.groan(0.6);
        }
        break;
      case "rushedBehind":
        sfx.groan(0.35);
        break;
      case "quarterEnd":
        // The fourth quarter's siren is sounded by fullTime.
        if (e.quarter < 4) {
          sfx.siren(3);
          sfx.applause(0.5, 5);
        }
        break;
      case "fullTime":
        sfx.siren(4.5);
        sfx.cheer(0.7, 8);
        break;
    }
  }

  onFrame(sample: SampledFrame, delta: number) {
    const [bx, by] = sample.ball;
    const toGoal = Math.min(Math.hypot(bx - GOAL_X, by), Math.hypot(bx + GOAL_X, by));
    const target = sample.frame.clockRunning ? 0.15 + 0.6 * Math.max(0, 1 - toGoal / 70) ** 1.5 : 0.1;
    this.excitement += (target - this.excitement) * Math.min(1, delta * 0.8);
    this.boost = Math.max(0, Math.min(0.5, this.boost) - delta * 0.12);

    // Audio automation piles up if pushed every frame; a few updates a second is plenty for a crowd.
    const now = performance.now();
    if (now - this.lastExcitementPush > 250) {
      this.engine.setExcitement(this.excitement + this.boost);
      this.lastExcitementPush = now;
    }

    this.checkManOn(sample);
  }

  /** A teammate yells a warning the moment an opponent closes in on the ball carrier. */
  private checkManOn(sample: SampledFrame) {
    const c = sample.frame.carrierIndex;
    if (c !== this.manOnCarrier) {
      this.manOnCarrier = c;
      this.manOnArmed = c >= 0;
    }
    if (!this.manOnArmed) return;

    const p = sample.players;
    const carrierHome = c < this.homeCount;
    const count = p.length / 2;
    let nearest = Infinity;
    for (let i = carrierHome ? this.homeCount : 0; i < (carrierHome ? count : this.homeCount); i++) {
      nearest = Math.min(nearest, Math.hypot(p[i * 2] - p[c * 2], p[i * 2 + 1] - p[c * 2 + 1]));
    }
    if (nearest < 5) {
      this.manOnArmed = false;
      if (Math.random() < 0.35) this.player("Man on!", this.placeAt(new THREE.Vector3(p[c * 2], 1, p[c * 2 + 1])));
    }
  }
}
