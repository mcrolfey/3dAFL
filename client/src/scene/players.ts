import * as THREE from "three";
import type { FieldPos, PlayerFieldState, TeamSummary } from "@3dafl/shared";

interface PlayerEntry {
  mesh: THREE.Group;
  target: THREE.Vector3;
  ring: THREE.Mesh;
}

const PLAYER_HEIGHT = 1.9;

function fieldToWorld(pos: FieldPos, y = PLAYER_HEIGHT / 2): THREE.Vector3 {
  return new THREE.Vector3(pos.x, y, pos.y);
}

export class PlayersManager {
  private entries = new Map<string, PlayerEntry>();
  private group = new THREE.Group();
  private currentCarrier: string | null = null;
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene, home: TeamSummary, away: TeamSummary) {
    this.scene = scene;
    scene.add(this.group);
    this.addTeam(home, home.color, -1);
    this.addTeam(away, away.color, 1);
  }

  dispose() {
    this.scene.remove(this.group);
    for (const entry of this.entries.values()) {
      entry.mesh.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
          else obj.material.dispose();
        }
      });
    }
    this.entries.clear();
  }

  private addTeam(team: TeamSummary, color: string, side: -1 | 1) {
    team.players.forEach((player, i) => {
      const body = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.55, PLAYER_HEIGHT - 1.1, 4, 8),
        new THREE.MeshStandardMaterial({ color }),
      );
      body.castShadow = true;

      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.9, 1.15, 24),
        new THREE.MeshBasicMaterial({ color: 0xffe066, side: THREE.DoubleSide, transparent: true, opacity: 0 }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.05;

      const wrapper = new THREE.Group();
      wrapper.add(body);
      wrapper.add(ring);

      const startPos = fieldToWorld({ x: side * 40, y: (i % 6) * 10 - 25 });
      wrapper.position.copy(startPos);

      this.group.add(wrapper);
      this.entries.set(player.id, { mesh: wrapper, target: startPos.clone(), ring });
    });
  }

  setPositions(positions: PlayerFieldState[]) {
    for (const p of positions) {
      const entry = this.entries.get(p.playerId);
      if (!entry) continue;
      entry.target = fieldToWorld(p.pos);
    }
  }

  setBallCarrier(playerId: string | null) {
    if (this.currentCarrier) {
      const prev = this.entries.get(this.currentCarrier);
      if (prev) (prev.ring.material as THREE.MeshBasicMaterial).opacity = 0;
    }
    this.currentCarrier = playerId;
    if (playerId) {
      const entry = this.entries.get(playerId);
      if (entry) (entry.ring.material as THREE.MeshBasicMaterial).opacity = 0.85;
    }
  }

  worldPositionOf(playerId: string): THREE.Vector3 | null {
    return this.entries.get(playerId)?.mesh.position ?? null;
  }

  update(delta: number) {
    // Slow, steady catch-up so players visibly run to their new spot between plays
    // instead of snapping there the instant a new position arrives.
    const lerpFactor = Math.min(1, delta * 0.9);
    for (const entry of this.entries.values()) {
      entry.mesh.position.lerp(entry.target, lerpFactor);
    }
  }
}
