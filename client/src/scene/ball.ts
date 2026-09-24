import * as THREE from "three";

/** The footy: an oval that points along its direction of travel and spins while it's in the air. */
export class BallView {
  readonly mesh: THREE.Mesh;
  private readonly last = new THREE.Vector3();
  private spin = 0;

  constructor(scene: THREE.Scene) {
    const geometry = new THREE.SphereGeometry(0.3, 16, 12);
    geometry.scale(1, 0.62, 0.62);
    this.mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xb3261e, roughness: 0.5 }));
    this.mesh.castShadow = true;
    this.mesh.position.set(0, 1, 0);
    scene.add(this.mesh);
  }

  /** x/y are field coordinates, height is meters above the ground. */
  update(x: number, y: number, height: number, delta: number) {
    const next = new THREE.Vector3(x, Math.max(0.2, height), y);
    const velocity = next.clone().sub(this.last);
    this.last.copy(next);
    this.mesh.position.copy(next);

    if (velocity.lengthSq() > 1e-4) {
      this.mesh.rotation.y = Math.atan2(-velocity.z, velocity.x);
    }
    if (height > 1.4 && delta > 0) {
      // Drop punt: end-over-end rotation while airborne.
      this.spin += delta * 14;
      this.mesh.rotation.z = this.spin;
    } else {
      this.mesh.rotation.z = 0;
    }
  }
}
