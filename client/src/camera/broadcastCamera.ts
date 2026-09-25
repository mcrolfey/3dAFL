import * as THREE from "three";

type CameraMode = "chase" | "goalReplay";

/** A broadcast-style camera rig: an elevated sideline chase cam that tracks the ball, with a brief cutaway on goals. */
export class BroadcastCamera {
  camera: THREE.PerspectiveCamera;
  private mode: CameraMode = "chase";
  private modeTimer = 0;
  private goalEndX = 0;
  private readonly desiredPos = new THREE.Vector3(0, 36, -74);
  private readonly desiredLook = new THREE.Vector3(0, 1, 0);
  private readonly look = new THREE.Vector3(0, 1, 0);

  constructor(aspect: number) {
    // A tight lens like a real broadcast camera: frames the contest, not the whole ground.
    this.camera = new THREE.PerspectiveCamera(26, aspect, 0.1, 600);
    this.camera.position.copy(this.desiredPos);
  }

  triggerGoalReplay(scoringEndX: number) {
    this.mode = "goalReplay";
    this.modeTimer = 3;
    this.goalEndX = scoringEndX;
  }

  onResize(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  update(delta: number, ball: THREE.Vector3) {
    if (this.mode === "goalReplay") {
      this.modeTimer -= delta;
      const side = Math.sign(this.goalEndX) || 1;
      this.desiredPos.set(this.goalEndX + side * 16, 6, 4);
      this.desiredLook.set(this.goalEndX - side * 18, 3, 0);
      if (this.modeTimer <= 0) this.mode = "chase";
    } else {
      // Main camera high on the wing: pans along the ground with the ball, pulls up a little when it's kicked high.
      this.desiredPos.set(ball.x * 0.75, 34 + ball.y * 0.4, -74 + ball.z * 0.3);
      this.desiredLook.set(ball.x, ball.y * 0.4, ball.z * 0.55);
    }

    const k = Math.min(1, delta * 2.2);
    this.camera.position.lerp(this.desiredPos, k);
    this.look.lerp(this.desiredLook, Math.min(1, delta * 4));
    this.camera.lookAt(this.look);
  }
}
