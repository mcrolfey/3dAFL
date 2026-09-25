import * as THREE from "three";

/** Auto mixes the sideline camera with drone shots like a live broadcast; TV and Drone lock to one style. */
export type CameraMode = "auto" | "tv" | "drone";

type Shot =
  | { kind: "wide" }
  | { kind: "droneChase" }
  | { kind: "droneTop"; until: number }
  | { kind: "droneOrbit"; center: THREE.Vector3; until: number }
  | { kind: "setShot"; kicker: THREE.Vector3; goal: THREE.Vector3; until: number }
  | { kind: "goalReplay"; goalX: number; until: number }
  | { kind: "goalOrbit"; goalX: number; until: number };

export interface CameraView {
  ball: THREE.Vector3;
  ballVelocity: THREE.Vector3;
  /** direction the team with (or last with) the ball is attacking along x: +1 or -1 */
  attackDir: 1 | -1;
}

const TV_FOV = 26;
const DRONE_FOV = 50;

/**
 * Broadcast camera director. Besides the main sideline camera it flies a "drone" — floaty, hovering, banking
 * into turns — that chases play from behind, looks straight down on centre bounces, circles stoppages, sits behind
 * the kicker for set shots and sweeps around the goal square after a goal. In Auto it cuts between the two like a
 * TV director would.
 */
export class CameraDirector {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = "auto";
  private shot: Shot = { kind: "wide" };
  private elapsed = 0;
  private nextCutAt = 12;
  private orbitAngle = 0;
  /** where the chase drone sits around the ball; swings round (never over the top) when play turns over */
  private chaseAngle = Math.PI + 0.4;
  private roll = 0;
  private snapNextFrame = false;
  private readonly desiredPos = new THREE.Vector3(0, 34, -74);
  private readonly desiredLook = new THREE.Vector3(0, 1, 0);
  private readonly look = new THREE.Vector3(0, 1, 0);
  private readonly lastPos = new THREE.Vector3(0, 34, -74);

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(TV_FOV, aspect, 0.1, 600);
    this.camera.position.copy(this.desiredPos);
  }

  onResize(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  setMode(mode: CameraMode) {
    this.mode = mode;
    this.switchTo(this.generalPlayShot(), true);
  }

  private get dronesAllowed() {
    return this.mode !== "tv";
  }

  private generalPlayShot(): Shot {
    return this.mode === "drone" ? { kind: "droneChase" } : { kind: "wide" };
  }

  private isDrone(shot: Shot) {
    return shot.kind !== "wide" && shot.kind !== "goalReplay";
  }

  /** Changing between the sideline camera and the drone is a hard cut; moves within one camera glide. */
  private switchTo(shot: Shot, forceCut = false) {
    const cut = forceCut || this.isDrone(shot) !== this.isDrone(this.shot);
    this.shot = shot;
    this.camera.fov = this.isDrone(shot) ? DRONE_FOV : TV_FOV;
    this.camera.updateProjectionMatrix();
    if (cut) this.snapNextFrame = true;
  }

  // --- match moments ---

  onCentreBounce() {
    if (this.dronesAllowed) this.switchTo({ kind: "droneTop", until: this.elapsed + 3.5 });
  }

  onStoppage(at: THREE.Vector3) {
    if (this.dronesAllowed && Math.random() < 0.5) {
      this.orbitAngle = Math.random() * Math.PI * 2;
      this.switchTo({ kind: "droneOrbit", center: at.clone(), until: this.elapsed + 4 });
    }
  }

  onSetShot(kicker: THREE.Vector3, goal: THREE.Vector3) {
    if (this.dronesAllowed) this.switchTo({ kind: "setShot", kicker: kicker.clone(), goal: goal.clone(), until: this.elapsed + 30 });
  }

  /** The ball's been kicked: a set-shot view holds a moment longer to watch it fly, then play resumes. */
  onDisposal() {
    if (this.shot.kind === "setShot") this.shot.until = Math.min(this.shot.until, this.elapsed + 2.5);
  }

  onGoal(goalX: number) {
    this.switchTo({ kind: "goalReplay", goalX, until: this.elapsed + 3 });
  }

  // --- per frame ---

  update(delta: number, view: CameraView) {
    this.elapsed += delta;
    const shot = this.shot;

    if ("until" in shot && this.elapsed >= shot.until) {
      if (shot.kind === "goalReplay" && this.dronesAllowed) {
        this.orbitAngle = Math.atan2(0, -Math.sign(shot.goalX));
        this.switchTo({ kind: "goalOrbit", goalX: shot.goalX, until: this.elapsed + 5 });
      } else {
        this.switchTo(this.generalPlayShot());
      }
      this.nextCutAt = this.elapsed + 10 + Math.random() * 8;
    } else if ((shot.kind === "wide" || shot.kind === "droneChase") && this.mode === "auto" && this.elapsed >= this.nextCutAt) {
      // In general play, cut between the sideline camera and the drone every so often.
      this.switchTo(shot.kind === "wide" ? { kind: "droneChase" } : { kind: "wide" });
      this.nextCutAt = this.elapsed + 10 + Math.random() * 8;
    }

    this.frame(this.shot, view, delta);

    const drone = this.isDrone(this.shot);
    if (this.snapNextFrame) {
      this.camera.position.copy(this.desiredPos);
      this.look.copy(this.desiredLook);
      this.snapNextFrame = false;
    } else {
      // The drone floats: softer follow, gentle hover drift. The sideline camera is tighter on the ball.
      const follow = drone ? 1.3 : 2.2;
      this.camera.position.lerp(this.desiredPos, Math.min(1, delta * follow));
      this.look.lerp(this.desiredLook, Math.min(1, delta * (drone ? 2.5 : 4)));
    }
    if (drone) {
      this.camera.position.y += Math.sin(this.elapsed * 1.3) * 0.015 + Math.sin(this.elapsed * 0.7) * 0.01;
    }
    this.camera.lookAt(this.look);

    // Bank into sideways movement like a drone does.
    const sideways = new THREE.Vector3().subVectors(this.camera.position, this.lastPos).dot(new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion));
    const targetRoll = drone && delta > 0 ? THREE.MathUtils.clamp((-sideways / delta) * 0.02, -0.14, 0.14) : 0;
    this.roll += (targetRoll - this.roll) * Math.min(1, delta * 3);
    this.camera.rotateZ(this.roll);
    this.lastPos.copy(this.camera.position);
  }

  /** Where each shot wants the camera to be and look. */
  private frame(shot: Shot, view: CameraView, delta: number) {
    const { ball } = view;
    switch (shot.kind) {
      case "wide":
        // Main camera high on the wing: pans with the ball, pulls up a little when it's kicked high.
        this.desiredPos.set(ball.x * 0.75, 34 + ball.y * 0.4, -74 + ball.z * 0.3);
        this.desiredLook.set(ball.x, ball.y * 0.4, ball.z * 0.55);
        break;
      case "droneChase": {
        // Behind the play and a little to the side, looking down the ground the way the ball's going. When the
        // direction of play flips, it arcs around the ball at the same distance rather than flying over it.
        const dir = view.attackDir;
        const targetAngle = dir > 0 ? Math.PI + 0.4 : -0.4;
        const turn = Math.atan2(Math.sin(targetAngle - this.chaseAngle), Math.cos(targetAngle - this.chaseAngle));
        this.chaseAngle += THREE.MathUtils.clamp(turn, -1.1 * delta, 1.1 * delta);
        this.desiredPos.set(ball.x + Math.cos(this.chaseAngle) * 18, 11 + ball.y * 0.5, ball.z + Math.sin(this.chaseAngle) * 18);
        this.desiredLook.set(ball.x - Math.cos(this.chaseAngle) * 10, 1, ball.z - Math.sin(this.chaseAngle) * 4);
        break;
      }
      case "droneTop":
        // Straight down over the bounce.
        this.desiredPos.set(ball.x, 34, ball.z + 1.5);
        this.desiredLook.set(ball.x, 0, ball.z);
        break;
      case "droneOrbit":
      case "goalOrbit": {
        const center = shot.kind === "droneOrbit" ? shot.center : new THREE.Vector3(shot.goalX, 0, 0);
        const radius = shot.kind === "droneOrbit" ? 16 : 22;
        this.orbitAngle += delta * (shot.kind === "droneOrbit" ? 0.35 : 0.25);
        this.desiredPos.set(center.x + Math.cos(this.orbitAngle) * radius, shot.kind === "droneOrbit" ? 9 : 14, center.z + Math.sin(this.orbitAngle) * radius);
        this.desiredLook.set(center.x, 1.5, center.z);
        break;
      }
      case "setShot": {
        // Behind the kicker, lined up on the goals, like Spidercam on a set shot.
        const toGoal = new THREE.Vector3().subVectors(shot.goal, shot.kicker).setY(0).normalize();
        this.desiredPos.copy(shot.kicker).addScaledVector(toGoal, -9).setY(5);
        this.desiredLook.copy(shot.goal).setY(4);
        break;
      }
      case "goalReplay": {
        // Low behind the goals, looking back at where it came from.
        const side = Math.sign(shot.goalX) || 1;
        this.desiredPos.set(shot.goalX + side * 16, 6, 4);
        this.desiredLook.set(shot.goalX - side * 18, 3, 0);
        break;
      }
    }
  }
}
