import * as THREE from "three";
import type { FieldPos, TeamSummary } from "@3dafl/shared";
import { buildFootballer, kitFor, PLAYER_HEIGHT, type Footballer, type Kit } from "./footballer.js";

/** 3x5 pixel font for jumper numbers. */
const DIGITS: Record<string, string[]> = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "001", "001", "001"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
};

/** A crisp pixel-art jumper number that floats above the player, TV-graphic style. */
function numberSprite(num: number, kit: Kit): THREE.Sprite {
  const text = String(num);
  const width = text.length * 4 + 3;
  const height = 9;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = kit.secondary;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = kit.primary;
  ctx.fillRect(1, 1, width - 2, height - 2);
  ctx.fillStyle = kit.secondary;
  [...text].forEach((digit, i) => {
    DIGITS[digit].forEach((row, y) => {
      [...row].forEach((bit, x) => {
        if (bit === "1") ctx.fillRect(2 + i * 4 + x, 2 + y, 1, 1);
      });
    });
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
  sprite.scale.set(width * 0.09, height * 0.09, 1);
  sprite.position.y = PLAYER_HEIGHT + 0.5;
  return sprite;
}

type ActionType = "kick" | "handball" | "tackle" | "tackled" | "missedTackle" | "spoil" | "ruckLeap";

const ACTION_SECONDS: Record<ActionType, number> = {
  kick: 0.7,
  handball: 0.6,
  tackle: 1.3,
  tackled: 1.35,
  missedTackle: 1.2,
  spoil: 0.6,
  ruckLeap: 0.7,
};

interface Action {
  type: ActionType;
  /** direction to face during the action; null keeps normal facing */
  heading: number | null;
  start: number;
}

/** Joint angles for one frame. lean -π/2 is lying face-down; arm/leg angles swing forward (+) and back (-). */
interface Pose {
  lean: number;
  lift: number;
  leftArm: number;
  rightArm: number;
  leftArmOut: number;
  rightArmOut: number;
  leftLeg: number;
  rightLeg: number;
}

interface Avatar {
  model: Footballer;
  ring: THREE.Mesh;
  stride: number;
  lastX: number;
  lastZ: number;
  heading: number;
  action: Action | null;
}

const LYING = Math.PI / 2 - 0.05;

function headingTo(dx: number, dz: number): number {
  return Math.atan2(-dz, dx);
}

/** 0 standing → 1 flat on the turf: goes down over [fallAt, downAt], stays down, gets back up over [upAt, end]. */
function downness(t: number, fallAt: number, downAt: number, upAt: number, end: number): number {
  if (t < fallAt) return 0;
  if (t < downAt) return (t - fallAt) / (downAt - fallAt);
  if (t < upAt) return 1;
  return Math.max(0, 1 - (t - upAt) / (end - upAt));
}

/** Overlays an action's movement on top of the running pose. */
function actionPose(type: ActionType, t: number, base: Pose): Pose {
  const pose = { ...base };
  switch (type) {
    case "kick": {
      // Quick wind-up, the leg swings through and follows through high, arms out for balance.
      pose.leftLeg = 0;
      pose.rightLeg = t < 0.06 ? -0.7 * (t / 0.06) : t < 0.2 ? -0.7 + 2.3 * ((t - 0.06) / 0.14) : 1.6 * Math.max(0, 1 - (t - 0.2) / 0.45);
      pose.leftArm = pose.rightArm = 0.3;
      pose.leftArmOut = pose.rightArmOut = 0.8;
      break;
    }
    case "handball":
      // The free hand punches through the ball held in the other.
      pose.leftArm = 1.1;
      pose.rightArm = t < 0.08 ? 0.5 : 1.6 * Math.max(0, 1 - (t - 0.08) / 0.4);
      break;
    case "tackle": {
      // Lunge, wrap the arms around the ball carrier, and take them to ground.
      const down = downness(t, 0.18, 0.45, 0.95, 1.3);
      const lunge = 0.5 * Math.min(1, t / 0.18) * (t < 0.95 ? 1 : Math.max(0, 1 - (t - 0.95) / 0.35));
      pose.lean = -Math.max(lunge, LYING * down);
      pose.leftArm = pose.rightArm = t < 0.95 ? 1.5 : 1.5 * Math.max(0, 1 - (t - 0.95) / 0.35);
      pose.leftArmOut = pose.rightArmOut = 0;
      pose.leftLeg = pose.rightLeg = 0;
      pose.lift = 0.15 * down;
      break;
    }
    case "tackled": {
      // Driven into the turf in the direction of the tackle.
      const down = downness(t, 0.1, 0.42, 1.0, 1.35);
      pose.lean = -LYING * down;
      pose.leftArm = pose.rightArm = down > 0 ? 2.2 : base.leftArm;
      pose.leftLeg = pose.rightLeg = 0;
      pose.lift = 0.15 * down;
      break;
    }
    case "missedTackle": {
      // Dives at the ball carrier, grabs at air, and ends up on the ground.
      const down = downness(t, 0.15, 0.4, 0.8, 1.2);
      pose.lean = -Math.max(0.6 * Math.min(1, t / 0.15) * (t < 0.8 ? 1 : 0), LYING * down);
      pose.leftArm = pose.rightArm = t < 0.8 ? 1.7 : 1.7 * Math.max(0, 1 - (t - 0.8) / 0.4);
      pose.leftLeg = pose.rightLeg = 0;
      pose.lift = 0.15 * down;
      break;
    }
    case "spoil":
      // Leaps and punches the ball away.
      pose.leftArm = 2.6;
      pose.rightArm = t < 0.3 ? 2.9 - 1.9 * (t / 0.3) : 1.0;
      pose.lift = 0.4 * Math.sin(Math.PI * Math.min(1, t / 0.5));
      break;
    case "ruckLeap":
      // Ruckman goes up to tap the ball down.
      pose.rightArm = 3.0;
      pose.leftArm = 2.2;
      pose.leftLeg = 0.3;
      pose.rightLeg = -0.2;
      pose.lift = 0.5 * Math.sin(Math.PI * Math.min(1, t / 0.55));
      break;
  }
  return pose;
}

/** Renders both teams as voxel footballers in roster order (home players then away), driven by physics frames. */
export class PlayersManager {
  private avatars: Avatar[] = [];
  private readonly group = new THREE.Group();
  private readonly material = new THREE.MeshLambertMaterial({ vertexColors: true });
  private readonly geometryCache = new Map<string, THREE.BufferGeometry>();
  private readonly indexById = new Map<string, number>();
  private readonly homeCount: number;

  constructor(
    private readonly scene: THREE.Scene,
    home: TeamSummary,
    away: TeamSummary,
  ) {
    scene.add(this.group);
    this.homeCount = home.players.length;
    for (const team of [home, away]) {
      const kit = kitFor(team.name, team.color);
      for (const player of team.players) {
        this.indexById.set(player.id, this.avatars.length);
        this.avatars.push(this.createAvatar(kit, player.id, player.number));
      }
    }
  }

  private createAvatar(kit: Kit, playerId: string, number: number): Avatar {
    const model = buildFootballer(kit, playerId, number, this.material, this.geometryCache);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.8, 1.05, 28),
      new THREE.MeshBasicMaterial({ color: 0xffe066, side: THREE.DoubleSide, transparent: true, opacity: 0 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    model.root.add(ring, numberSprite(number, kit));
    this.group.add(model.root);
    return { model, ring, stride: Math.random() * Math.PI, lastX: 0, lastZ: 0, heading: 0, action: null };
  }

  private avatar(playerId: string): Avatar | undefined {
    const i = this.indexById.get(playerId);
    return i === undefined ? undefined : this.avatars[i];
  }

  positionOf(playerId: string): THREE.Vector3 | null {
    return this.avatar(playerId)?.model.root.position.clone() ?? null;
  }

  private isActive(a: Avatar, type: ActionType): boolean {
    return a.action?.type === type && (performance.now() - a.action.start) / 1000 < ACTION_SECONDS[type];
  }

  /** The player turns to face where the ball's going and plays the kick or handball motion. */
  playDisposal(playerId: string, type: "kick" | "handball", from: FieldPos, to: FieldPos) {
    const a = this.avatar(playerId);
    // A handball fired out while being tackled happens on the way down — don't stand them back up for it.
    if (!a || this.isActive(a, "tackled")) return;
    a.action = { type, heading: headingTo(to.x - from.x, to.y - from.y), start: performance.now() };
  }

  /** Both players go to ground in a tackle that sticks; a missed tackle leaves the tackler on the turf. */
  playTackle(tacklerId: string, carrierId: string, broken: boolean) {
    const tackler = this.avatar(tacklerId);
    const carrier = this.avatar(carrierId);
    if (!tackler || !carrier) return;
    const heading = headingTo(carrier.lastX - tackler.lastX, carrier.lastZ - tackler.lastZ);
    const start = performance.now();
    if (broken) {
      tackler.action = { type: "missedTackle", heading, start };
    } else {
      tackler.action = { type: "tackle", heading, start };
      carrier.action = { type: "tackled", heading, start };
    }
  }

  playSpoil(playerId: string) {
    const a = this.avatar(playerId);
    if (a) a.action = { type: "spoil", heading: null, start: performance.now() };
  }

  playRuckLeap(playerId: string) {
    const a = this.avatar(playerId);
    if (a) a.action = { type: "ruckLeap", heading: null, start: performance.now() };
  }

  update(positions: Float32Array, carrierIndex: number, ball: [number, number, number], quarter: number, delta: number) {
    const now = performance.now();
    // Home attacks toward +x in odd quarters; teams swap ends each quarter.
    const homeAttacksPositive = quarter % 2 === 1;

    this.avatars.forEach((a, i) => {
      const x = positions[i * 2];
      const z = positions[i * 2 + 1];
      const vx = delta > 0 ? (x - a.lastX) / delta : 0;
      const vz = delta > 0 ? (z - a.lastZ) / delta : 0;
      const speed = Math.min(10, Math.hypot(vx, vz));
      a.lastX = x;
      a.lastZ = z;

      const { root, body, leftArm, rightArm, leftLeg, rightLeg } = a.model;
      root.position.set(x, 0, z);

      if (a.action && (now - a.action.start) / 1000 > ACTION_SECONDS[a.action.type]) a.action = null;
      const action = a.action;

      // Mid-action: face the kick/tackle. Holding the ball without really running (e.g. backing up for a set shot):
      // look upfield at the goal. Otherwise face the way you're moving.
      let targetHeading = a.heading;
      if (action?.heading != null) targetHeading = action.heading;
      else if (i === carrierIndex && speed < 4) targetHeading = (i < this.homeCount) === homeAttacksPositive ? 0 : Math.PI;
      else if (speed > 0.5) targetHeading = headingTo(vx, vz);
      const turn = Math.atan2(Math.sin(targetHeading - a.heading), Math.cos(targetHeading - a.heading));
      a.heading += turn * Math.min(1, delta * (action?.heading != null ? 25 : 8));
      root.rotation.y = a.heading;

      a.stride += speed * delta * 2.4;
      const effort = Math.min(1, speed / 7);
      const swing = Math.sin(a.stride) * effort * 0.85;
      const leaping = ball[2] > 1.6 && ball[2] < 4.5 && Math.hypot(ball[0] - x, ball[1] - z) < 2.2;

      let pose: Pose = {
        lean: -Math.min(1, speed / 9) * 0.2,
        lift: Math.abs(Math.sin(a.stride)) * 0.06 * effort,
        leftArm: -swing * 0.8,
        rightArm: swing * 0.8,
        leftArmOut: 0,
        rightArmOut: 0,
        leftLeg: swing,
        rightLeg: -swing,
      };
      if (leaping) {
        // Going up for the mark: arms reach overhead and the player leaves the ground.
        pose.leftArm = pose.rightArm = 2.8;
        pose.lift = 0.35;
      } else if (i === carrierIndex) {
        pose.leftArm = pose.rightArm = 1.2;
      }
      if (action) pose = actionPose(action.type, (now - action.start) / 1000, pose);

      body.rotation.z = pose.lean;
      body.position.y = pose.lift;
      leftArm.rotation.z = pose.leftArm;
      rightArm.rotation.z = pose.rightArm;
      leftArm.rotation.x = pose.leftArmOut;
      rightArm.rotation.x = -pose.rightArmOut;
      leftLeg.rotation.z = pose.leftLeg;
      rightLeg.rotation.z = pose.rightLeg;

      (a.ring.material as THREE.MeshBasicMaterial).opacity = i === carrierIndex ? 0.9 : 0;
    });
  }

  dispose() {
    this.scene.remove(this.group);
    for (const g of this.geometryCache.values()) g.dispose();
    this.material.dispose();
    for (const a of this.avatars) {
      a.ring.geometry.dispose();
      (a.ring.material as THREE.Material).dispose();
      a.model.root.traverse((obj) => {
        if (obj instanceof THREE.Sprite) {
          obj.material.map?.dispose();
          obj.material.dispose();
        }
      });
    }
    this.avatars = [];
  }
}
