import * as THREE from "three";
import type { TeamSummary } from "@3dafl/shared";

const PLAYER_HEIGHT = 1.9;

interface Avatar {
  root: THREE.Group;
  body: THREE.Mesh;
  ring: THREE.Mesh;
  stride: number;
  lastX: number;
  lastZ: number;
}

function numberSprite(num: number, color: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(32, 32, 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 30px Segoe UI, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(num), 32, 34);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false }));
  sprite.scale.set(1.1, 1.1, 1);
  sprite.position.y = PLAYER_HEIGHT + 0.7;
  return sprite;
}

/** Renders both teams in roster order (home players then away), driven by interpolated physics frames. */
export class PlayersManager {
  private avatars: Avatar[] = [];
  private group = new THREE.Group();

  constructor(
    private readonly scene: THREE.Scene,
    home: TeamSummary,
    away: TeamSummary,
  ) {
    scene.add(this.group);
    for (const team of [home, away]) {
      const bodyMaterial = new THREE.MeshStandardMaterial({ color: team.color, roughness: 0.6 });
      for (const player of team.players) this.avatars.push(this.createAvatar(bodyMaterial, player.number, team.color));
    }
  }

  private createAvatar(material: THREE.Material, number: number, color: string): Avatar {
    const root = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, PLAYER_HEIGHT - 0.9, 4, 10), material);
    body.position.y = PLAYER_HEIGHT / 2;
    body.castShadow = true;
    root.add(body);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.8, 1.05, 28),
      new THREE.MeshBasicMaterial({ color: 0xffe066, side: THREE.DoubleSide, transparent: true, opacity: 0 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    root.add(ring);
    root.add(numberSprite(number, color));

    this.group.add(root);
    return { root, body, ring, stride: Math.random() * Math.PI, lastX: 0, lastZ: 0 };
  }

  update(positions: Float32Array, carrierIndex: number, delta: number) {
    this.avatars.forEach((a, i) => {
      const x = positions[i * 2];
      const z = positions[i * 2 + 1];
      const vx = delta > 0 ? (x - a.lastX) / delta : 0;
      const vz = delta > 0 ? (z - a.lastZ) / delta : 0;
      const speed = Math.min(10, Math.hypot(vx, vz));
      a.lastX = x;
      a.lastZ = z;

      a.root.position.set(x, 0, z);
      if (speed > 0.5) a.root.rotation.y = Math.atan2(-vz, vx);
      // Lean into the run and bob with each stride.
      a.stride += speed * delta * 1.7;
      a.body.rotation.z = -Math.min(1, speed / 9) * 0.28;
      a.body.position.y = PLAYER_HEIGHT / 2 + Math.abs(Math.sin(a.stride)) * 0.12 * Math.min(1, speed / 6);

      (a.ring.material as THREE.MeshBasicMaterial).opacity = i === carrierIndex ? 0.9 : 0;
    });
  }

  worldPosition(index: number): THREE.Vector3 | null {
    return this.avatars[index]?.root.position ?? null;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Sprite) {
        obj.geometry.dispose();
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of materials) {
          if ("map" in m && m.map instanceof THREE.Texture) m.map.dispose();
          m.dispose();
        }
      }
    });
    this.avatars = [];
  }
}
