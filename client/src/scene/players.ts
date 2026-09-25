import * as THREE from "three";
import type { FieldPos, TeamSummary } from "@3dafl/shared";
import { buildFootballer, kitFor, VOXEL, type Footballer, type Kit } from "./footballer.js";

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
  sprite.position.y = 22 * VOXEL + 0.5;
  return sprite;
}

interface DisposalAction {
  type: "kick" | "handball";
  heading: number;
  start: number;
}

interface Avatar {
  model: Footballer;
  ring: THREE.Mesh;
  stride: number;
  lastX: number;
  lastZ: number;
  heading: number;
  action: DisposalAction | null;
}

const ACTION_SECONDS = 0.7;

function headingTo(dx: number, dz: number): number {
  return Math.atan2(-dz, dx);
}

/** Kick: quick wind-up then the leg swings through and follows through high. */
function kickLegAngle(t: number): number {
  if (t < 0.06) return -0.7 * (t / 0.06);
  if (t < 0.2) return -0.7 + 2.3 * ((t - 0.06) / 0.14);
  return 1.6 * Math.max(0, 1 - (t - 0.2) / 0.45);
}

/** Handball: the free hand punches through the ball held in the other. */
function handballArmAngle(t: number): number {
  if (t < 0.08) return 0.5;
  return 1.6 * Math.max(0, 1 - (t - 0.08) / 0.4);
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

  /** The player turns to face where the ball's going and plays the kick or handball motion. */
  playDisposal(playerId: string, type: "kick" | "handball", from: FieldPos, to: FieldPos) {
    const i = this.indexById.get(playerId);
    if (i === undefined) return;
    this.avatars[i].action = { type, heading: headingTo(to.x - from.x, to.y - from.y), start: performance.now() };
  }

  private createAvatar(kit: Kit, playerId: string, number: number): Avatar {
    const model = buildFootballer(kit, playerId, this.material, this.geometryCache);
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

      if (a.action && (now - a.action.start) / 1000 > ACTION_SECONDS) a.action = null;
      const action = a.action;

      // Mid-kick: face the kick. Holding the ball without really running (e.g. backing up for a set shot): look
      // upfield at the goal. Otherwise face the way you're moving.
      let targetHeading = a.heading;
      if (action) targetHeading = action.heading;
      else if (i === carrierIndex && speed < 4) targetHeading = (i < this.homeCount) === homeAttacksPositive ? 0 : Math.PI;
      else if (speed > 0.5) targetHeading = headingTo(vx, vz);
      const turn = Math.atan2(Math.sin(targetHeading - a.heading), Math.cos(targetHeading - a.heading));
      a.heading += turn * Math.min(1, delta * (action ? 25 : 8));
      root.rotation.y = a.heading;

      a.stride += speed * delta * 2.4;
      const effort = Math.min(1, speed / 7);
      const swing = Math.sin(a.stride) * effort * 0.85;
      const leaping = ball[2] > 1.6 && ball[2] < 4.5 && Math.hypot(ball[0] - x, ball[1] - z) < 2.2;

      leftLeg.rotation.z = swing;
      rightLeg.rotation.z = -swing;
      leftArm.rotation.x = rightArm.rotation.x = 0;

      if (action) {
        const t = (now - action.start) / 1000;
        if (action.type === "kick") {
          leftLeg.rotation.z = 0;
          rightLeg.rotation.z = kickLegAngle(t);
          // Arms out wide for balance.
          leftArm.rotation.z = rightArm.rotation.z = 0.3;
          leftArm.rotation.x = 0.8;
          rightArm.rotation.x = -0.8;
        } else {
          leftArm.rotation.z = 1.1;
          rightArm.rotation.z = handballArmAngle(t);
        }
      } else if (leaping) {
        // Going up for the mark: arms reach overhead and the player leaves the ground.
        leftArm.rotation.z = rightArm.rotation.z = 2.8;
      } else if (i === carrierIndex) {
        leftArm.rotation.z = rightArm.rotation.z = 1.2;
      } else {
        leftArm.rotation.z = -swing * 0.8;
        rightArm.rotation.z = swing * 0.8;
      }
      body.rotation.z = -Math.min(1, speed / 9) * 0.2;
      body.position.y = leaping ? 0.35 : Math.abs(Math.sin(a.stride)) * 0.06 * effort;

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
