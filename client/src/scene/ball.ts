import * as THREE from "three";

export class BallController {
  mesh: THREE.Mesh;
  private flying = false;
  private t = 0;
  private duration = 1;
  private from = new THREE.Vector3();
  private to = new THREE.Vector3();
  private arcHeight = 4;

  constructor(scene: THREE.Scene) {
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.35, 12, 12),
      new THREE.MeshStandardMaterial({ color: 0xa0522d }),
    );
    this.mesh.castShadow = true;
    this.mesh.position.set(0, 1, 0);
    scene.add(this.mesh);
  }

  kickTo(from: THREE.Vector3, to: THREE.Vector3, durationSeconds: number, arcHeight = 5) {
    this.from.copy(from);
    this.to.copy(to);
    this.duration = Math.max(0.2, durationSeconds);
    this.arcHeight = arcHeight;
    this.t = 0;
    this.flying = true;
  }

  snapTo(pos: THREE.Vector3) {
    this.flying = false;
    this.mesh.position.copy(pos).add(new THREE.Vector3(0, 1, 0));
  }

  update(delta: number) {
    if (!this.flying) return;
    this.t += delta / this.duration;
    if (this.t >= 1) {
      this.t = 1;
      this.flying = false;
    }
    const pos = this.from.clone().lerp(this.to, this.t);
    pos.y += Math.sin(this.t * Math.PI) * this.arcHeight;
    this.mesh.position.copy(pos);
  }

  isFlying() {
    return this.flying;
  }
}
