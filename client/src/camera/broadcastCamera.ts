import * as THREE from "three";

type CameraMode = "chase" | "goalReplay";

/** A broadcast-style camera rig: an elevated sideline chase cam that tracks the ball, with a brief cutaway on goals. */
export class BroadcastCamera {
  camera: THREE.PerspectiveCamera;
  private mode: CameraMode = "chase";
  private modeTimer = 0;
  private goalEndX = 0;
  private desiredPos = new THREE.Vector3(0, 38, -75);
  private lookAt = new THREE.Vector3(0, 1, 0);

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 500);
    this.camera.position.copy(this.desiredPos);
  }

  triggerGoalReplay(scoringEndX: number) {
    this.mode = "goalReplay";
    this.modeTimer = 2.6;
    this.goalEndX = scoringEndX;
  }

  onResize(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  update(delta: number, focus: THREE.Vector3) {
    if (this.mode === "goalReplay") {
      this.modeTimer -= delta;
      const behindGoal = this.goalEndX > 0 ? this.goalEndX + 14 : this.goalEndX - 14;
      this.desiredPos.set(behindGoal, 7, 0);
      this.lookAt.set(this.goalEndX - Math.sign(this.goalEndX) * 10, 1.5, 0);
      if (this.modeTimer <= 0) this.mode = "chase";
    } else {
      this.desiredPos.set(focus.x * 0.6, 38, -75);
      this.lookAt.set(focus.x, 1, focus.z * 0.4);
    }

    this.camera.position.lerp(this.desiredPos, Math.min(1, delta * 2));
    this.camera.lookAt(this.lookAt);
  }
}
