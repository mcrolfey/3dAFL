import * as THREE from "three";
import type { ScoreLine } from "@3dafl/shared";
import { HALF_LENGTH as A, HALF_WIDTH as B } from "./field.js";

const SEGMENTS = 240;
/** every Nth segment of the bowl is a stairway, not seats */
const AISLE_EVERY = 12;
const FENCE_D = 4;
const LOWER = { startD: 10, startY: 1.4, rows: 18, depth: 0.9, rise: 0.42 };
const CONCOURSE = 3;
const UPPER = { rows: 14, depth: 0.9, rise: 0.56, facade: 3.2 };
/** keep the roof off the two ends, where the big screens sit */
const ROOFLESS_ENDS = 0.32;

const COLORS = {
  seat: new THREE.Color("#22314f"),
  aisle: new THREE.Color("#b9bbbf"),
  riser: new THREE.Color("#6e7075"),
  concrete: new THREE.Color("#9a9ca1"),
  facade: new THREE.Color("#2b2f37"),
  band: new THREE.Color("#12151b"),
  roof: new THREE.Color("#d9dde2"),
  tarmac: new THREE.Color("#3b3d40"),
};

const SKIN = ["#f1c7a3", "#e3b08c", "#c9906a", "#a86d4b", "#7c4d35", "#5c3a28"].map((c) => new THREE.Color(c));
const NEUTRAL = ["#e8e8e8", "#3a3f4a", "#8a6d4a", "#5a7fa8", "#9b3b3b", "#2f5d3a", "#c9b458", "#6b4f8a"].map((c) => new THREE.Color(c));

function theta(segment: number): number {
  return (segment / SEGMENTS) * Math.PI * 2;
}

/** A point `d` meters outside the boundary line, measured along the ellipse's outward normal. */
function ring(t: number, d: number): { x: number; z: number; nx: number; nz: number } {
  const gx = Math.cos(t) / A;
  const gz = Math.sin(t) / B;
  const len = Math.hypot(gx, gz);
  const nx = gx / len;
  const nz = gz / len;
  return { x: Math.cos(t) * A + nx * d, z: Math.sin(t) * B + nz * d, nx, nz };
}

function nearEnd(segment: number): boolean {
  const t = theta(segment + 0.5);
  return Math.abs(Math.sin(t)) < Math.sin(ROOFLESS_ENDS);
}

/** Collects triangles for surfaces swept around the whole bowl from a 2D profile. */
class BowlMesher {
  private positions: number[] = [];
  private colors: number[] = [];

  /** Sweeps the profile segment (d0, y0)→(d1, y1) around the bowl, coloured per segment. */
  sweep(d0: number, y0: number, d1: number, y1: number, colorAt: (segment: number) => THREE.Color, skip?: (segment: number) => boolean) {
    for (let s = 0; s < SEGMENTS; s++) {
      if (skip?.(s)) continue;
      const a0 = ring(theta(s), d0);
      const b0 = ring(theta(s), d1);
      const a1 = ring(theta(s + 1), d0);
      const b1 = ring(theta(s + 1), d1);
      const quad = [
        [a0.x, y0, a0.z], [a1.x, y0, a1.z], [b1.x, y1, b1.z],
        [a0.x, y0, a0.z], [b1.x, y1, b1.z], [b0.x, y1, b0.z],
      ];
      const c = colorAt(s);
      for (const [x, y, z] of quad) {
        this.positions.push(x, y, z);
        this.colors.push(c.r, c.g, c.b);
      }
    }
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.computeVertexNormals();
    return geometry;
  }
}

interface SeatRow {
  d: number;
  y: number;
  occupancy: number;
}

/** Builds the seating bowl and returns where each row of seats is, for placing the crowd. */
function buildBowl(): { mesh: THREE.Mesh; rows: SeatRow[]; topD: number; topY: number; upperStartD: number } {
  const m = new BowlMesher();
  const rows: SeatRow[] = [];
  const seatColor = (s: number) => (s % AISLE_EVERY === 0 ? COLORS.aisle : COLORS.seat);
  const flat = (c: THREE.Color) => () => c;

  m.sweep(FENCE_D, 0.02, LOWER.startD, 0.02, flat(COLORS.tarmac));
  m.sweep(LOWER.startD, 0, LOWER.startD, LOWER.startY, flat(COLORS.band));
  for (let i = 0; i < LOWER.rows; i++) {
    const d = LOWER.startD + i * LOWER.depth;
    const y = LOWER.startY + i * LOWER.rise;
    m.sweep(d, y, d + LOWER.depth, y, seatColor);
    m.sweep(d + LOWER.depth, y, d + LOWER.depth, y + LOWER.rise, flat(COLORS.riser));
    rows.push({ d: d + LOWER.depth * 0.45, y, occupancy: 0.85 });
  }

  const lowerEndD = LOWER.startD + LOWER.rows * LOWER.depth;
  const lowerEndY = LOWER.startY + LOWER.rows * LOWER.rise;
  const upperStartD = lowerEndD + CONCOURSE;
  m.sweep(lowerEndD, lowerEndY, upperStartD, lowerEndY, flat(COLORS.concrete));
  m.sweep(upperStartD, lowerEndY, upperStartD, lowerEndY + UPPER.facade, flat(COLORS.band));

  const upperY = lowerEndY + UPPER.facade;
  for (let i = 0; i < UPPER.rows; i++) {
    const d = upperStartD + i * UPPER.depth;
    const y = upperY + i * UPPER.rise;
    m.sweep(d, y, d + UPPER.depth, y, seatColor);
    m.sweep(d + UPPER.depth, y, d + UPPER.depth, y + UPPER.rise, flat(COLORS.riser));
    rows.push({ d: d + UPPER.depth * 0.45, y, occupancy: 0.75 });
  }

  const topD = upperStartD + UPPER.rows * UPPER.depth;
  const topY = upperY + UPPER.rows * UPPER.rise;
  m.sweep(topD, topY, topD + 1, topY, flat(COLORS.concrete));
  m.sweep(topD + 1, topY, topD + 1, 0, flat(COLORS.facade));

  const mesh = new THREE.Mesh(m.build(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  mesh.receiveShadow = true;
  return { mesh, rows, topD, topY, upperStartD };
}

function buildRoof(upperStartD: number, topD: number, topY: number): THREE.Group {
  const group = new THREE.Group();
  const m = new BowlMesher();
  const frontY = topY + 7.5;
  const backY = topY + 6;
  // Cantilevered roof over the upper tier, rising slightly toward the ground.
  m.sweep(topD + 1, backY, upperStartD - 2, frontY, () => COLORS.roof, nearEnd);
  m.sweep(upperStartD - 2, frontY, upperStartD - 2, frontY - 0.8, () => COLORS.band, nearEnd);
  group.add(new THREE.Mesh(m.build(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));

  const pillarGeometry = new THREE.CylinderGeometry(0.35, 0.45, backY - topY, 8);
  const pillarMaterial = new THREE.MeshLambertMaterial({ color: COLORS.concrete });
  for (let s = 0; s < SEGMENTS; s += 10) {
    if (nearEnd(s)) continue;
    const p = ring(theta(s), topD + 0.6);
    const pillar = new THREE.Mesh(pillarGeometry, pillarMaterial);
    pillar.position.set(p.x, topY + (backY - topY) / 2, p.z);
    group.add(pillar);
  }
  return group;
}

/** The boundary fence, lined with made-up advertising boards. */
function buildFence(): THREE.Mesh {
  const canvas = document.createElement("canvas");
  // One repeat of the boards is 32m long and 1m high, so the canvas is 32:1 to keep the lettering in proportion.
  canvas.width = 2048;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const panels = [
    { bg: "#1f6fb2", fg: "#ffffff", text: "3dAFL" },
    { bg: "#111418", fg: "#e8b923", text: "FOOTY" },
    { bg: "#c0392b", fg: "#ffffff", text: "GO TEAMS" },
    { bg: "#f4f4f4", fg: "#1c1c1c", text: "SEASON 2027" },
  ];
  const w = canvas.width / panels.length;
  panels.forEach((p, i) => {
    ctx.fillStyle = p.bg;
    ctx.fillRect(i * w, 0, w, canvas.height);
    ctx.fillStyle = p.fg;
    ctx.font = "bold 44px Segoe UI, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(p.text, i * w + w / 2, canvas.height / 2 + 2, w - 40);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;

  const positions: number[] = [];
  const uvs: number[] = [];
  let arc = 0;
  const metersPerRepeat = 32;
  for (let s = 0; s < SEGMENTS; s++) {
    const p0 = ring(theta(s), FENCE_D);
    const p1 = ring(theta(s + 1), FENCE_D);
    const len = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    const u0 = arc / metersPerRepeat;
    const u1 = (arc + len) / metersPerRepeat;
    arc += len;
    positions.push(p0.x, 0, p0.z, p1.x, 0, p1.z, p1.x, 1, p1.z, p0.x, 0, p0.z, p1.x, 1, p1.z, p0.x, 1, p0.z);
    uvs.push(u0, 0, u1, 0, u1, 1, u0, 0, u1, 1, u0, 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }));
}

function buildLightTowers(topD: number): THREE.Group {
  const group = new THREE.Group();
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 48;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#1a1c20";
  ctx.fillRect(0, 0, 64, 48);
  ctx.fillStyle = "#fffbe8";
  for (let x = 0; x < 8; x++) for (let y = 0; y < 6; y++) ctx.fillRect(x * 8 + 1, y * 8 + 1, 6, 6);
  const lights = new THREE.CanvasTexture(canvas);
  lights.magFilter = THREE.NearestFilter;
  lights.colorSpace = THREE.SRGBColorSpace;

  const column = new THREE.CylinderGeometry(0.7, 1.1, 58, 8);
  const columnMaterial = new THREE.MeshLambertMaterial({ color: "#8f949b" });
  for (const t of [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]) {
    const p = ring(t, topD + 9);
    const tower = new THREE.Group();
    const pole = new THREE.Mesh(column, columnMaterial);
    pole.position.y = 29;
    tower.add(pole);
    const bank = new THREE.Mesh(new THREE.PlaneGeometry(10, 7.5), new THREE.MeshBasicMaterial({ map: lights, side: THREE.DoubleSide }));
    bank.position.y = 60;
    tower.add(bank);
    tower.position.set(p.x, 0, p.z);
    bank.lookAt(new THREE.Vector3(-p.x * 0.2, 0, -p.z * 0.2).sub(tower.position).add(bank.getWorldPosition(new THREE.Vector3())));
    group.add(tower);
  }
  return group;
}

/**
 * The stadium around the oval: a two-tier seating bowl full of voxel supporters, a cantilevered roof, light
 * towers, advertising fence and big screens at each end showing the live score.
 */
export class Stadium {
  readonly group = new THREE.Group();
  private readonly bodies: THREE.InstancedMesh;
  private readonly heads: THREE.InstancedMesh;
  private readonly home: boolean[] = [];
  private readonly time = { value: 0 };
  private readonly cheerLevel = { value: 0 };
  private cheerTarget = 0;
  private readonly screens: { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture }[] = [];
  private teams = { home: { name: "HOME", color: "#1f6fb2" }, away: { name: "AWAY", color: "#c0392b" } };
  private score: { home: ScoreLine; away: ScoreLine } = { home: { goals: 0, behinds: 0 }, away: { goals: 0, behinds: 0 } };
  private clockText = "";

  constructor() {
    const bowl = buildBowl();
    this.group.add(bowl.mesh, buildRoof(bowl.upperStartD, bowl.topD, bowl.topY), buildFence(), buildLightTowers(bowl.topD));

    // Crowd: one instanced body and head per supporter, facing the ground.
    const placements: { x: number; y: number; z: number; facing: number; t: number }[] = [];
    for (const row of bowl.rows) {
      for (let s = 0; s < SEGMENTS; s++) {
        if (s % AISLE_EVERY === 0) continue;
        const p0 = ring(theta(s), row.d);
        const p1 = ring(theta(s + 1), row.d);
        const seats = Math.floor(Math.hypot(p1.x - p0.x, p1.z - p0.z) / 0.95);
        for (let k = 0; k < seats; k++) {
          if (Math.random() > row.occupancy) continue;
          const f = (k + 0.5) / seats;
          placements.push({
            x: p0.x + (p1.x - p0.x) * f,
            y: row.y,
            z: p0.z + (p1.z - p0.z) * f,
            facing: Math.atan2(p0.nx, p0.nz),
            t: theta(s + f),
          });
        }
      }
    }

    const bodyMaterial = new THREE.MeshLambertMaterial();
    const headMaterial = new THREE.MeshLambertMaterial();
    for (const material of [bodyMaterial, headMaterial]) this.addCheerMotion(material);
    this.bodies = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.7, 0.4), bodyMaterial, placements.length);
    this.heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), headMaterial, placements.length);

    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);
    placements.forEach((p, i) => {
      rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.facing);
      this.bodies.setMatrixAt(i, matrix.compose(new THREE.Vector3(p.x, p.y + 0.8, p.z), rotation, scale));
      this.heads.setMatrixAt(i, matrix.compose(new THREE.Vector3(p.x, p.y + 1.3, p.z), rotation, scale));
      this.heads.setColorAt(i, SKIN[Math.floor(Math.random() * SKIN.length)]);
      // Home fans fill the far side, away fans the near side, with plenty mixed in — as at the footy.
      const homeSide = Math.sin(p.t) > 0;
      this.home.push(Math.random() < (homeSide ? 0.75 : 0.25));
    });
    this.group.add(this.bodies, this.heads);
    this.recolourCrowd();

    for (const t of [0, Math.PI]) this.group.add(this.buildScreen(t, bowl.topD, bowl.topY));
    this.redrawScreens();
  }

  /** Every supporter bobs a little; when the crowd erupts they're up out of their seats, jumping. */
  private addCheerMotion(material: THREE.Material) {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.time;
      shader.uniforms.uCheer = this.cheerLevel;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uTime;\nuniform float uCheer;")
        .replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\n" +
            "float crowdPhase = float(gl_InstanceID) * 1.37;\n" +
            "transformed.y += (0.02 + uCheer * 0.5) * max(0.0, sin(uTime * (2.0 + uCheer * 7.0) + crowdPhase));",
        );
    };
  }

  private recolourCrowd() {
    const home = new THREE.Color(this.teams.home.color);
    const away = new THREE.Color(this.teams.away.color);
    const white = new THREE.Color("#f2f2f2");
    for (let i = 0; i < this.home.length; i++) {
      const roll = Math.random();
      const colour =
        roll < 0.12 ? NEUTRAL[Math.floor(Math.random() * NEUTRAL.length)] : roll < 0.22 ? white : this.home[i] ? home : away;
      this.bodies.setColorAt(i, colour);
    }
    if (this.bodies.instanceColor) this.bodies.instanceColor.needsUpdate = true;
    if (this.heads.instanceColor) this.heads.instanceColor.needsUpdate = true;
  }

  private buildScreen(t: number, topD: number, topY: number): THREE.Group {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 360;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.screens.push({ canvas, texture });

    const group = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(20, 11.5, 1), new THREE.MeshLambertMaterial({ color: COLORS.band }));
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(19, 10.7), new THREE.MeshBasicMaterial({ map: texture }));
    screen.position.z = 0.51;
    const legs = new THREE.Mesh(new THREE.BoxGeometry(12, 6, 0.8), new THREE.MeshLambertMaterial({ color: COLORS.facade }));
    legs.position.y = -8.5;
    group.add(frame, screen, legs);
    const p = ring(t, topD - 4);
    group.position.set(p.x, topY + 9.5, p.z);
    group.lookAt(0, topY + 9.5, 0);
    return group;
  }

  private redrawScreens() {
    const pts = (s: ScoreLine) => s.goals * 6 + s.behinds;
    for (const { canvas, texture } of this.screens) {
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#0b0f14";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const rows: [string, string, ScoreLine][] = [
        [this.teams.home.name, this.teams.home.color, this.score.home],
        [this.teams.away.name, this.teams.away.color, this.score.away],
      ];
      rows.forEach(([name, color, s], i) => {
        const y = 80 + i * 120;
        ctx.fillStyle = color;
        ctx.fillRect(30, y - 40, 16, 80);
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 44px Segoe UI, Arial, sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(name.toUpperCase(), 64, y, 330);
        ctx.textAlign = "right";
        ctx.font = "bold 56px Segoe UI, Arial, sans-serif";
        ctx.fillText(`${s.goals}.${s.behinds}  ${pts(s)}`, canvas.width - 30, y);
      });
      ctx.fillStyle = "#e8b923";
      ctx.font = "bold 40px Segoe UI, Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(this.clockText, canvas.width / 2, 320);
      texture.needsUpdate = true;
    }
  }

  setTeams(home: { name: string; color: string }, away: { name: string; color: string }) {
    this.teams = { home, away };
    this.score = { home: { goals: 0, behinds: 0 }, away: { goals: 0, behinds: 0 } };
    this.recolourCrowd();
    this.redrawScreens();
  }

  setScore(home: ScoreLine, away: ScoreLine) {
    if (home.goals === this.score.home.goals && home.behinds === this.score.home.behinds && away.goals === this.score.away.goals && away.behinds === this.score.away.behinds) return;
    this.score = { home: { ...home }, away: { ...away } };
    this.redrawScreens();
  }

  setClock(quarter: number, secondsRemaining: number) {
    const secs = Math.floor(secondsRemaining);
    const text = `Q${quarter}  ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
    if (text === this.clockText) return;
    this.clockText = text;
    this.redrawScreens();
  }

  /** 0 settled .. 1 on their feet. Decays back down on its own. */
  cheer(level: number) {
    this.cheerTarget = Math.max(this.cheerTarget, level);
  }

  update(delta: number) {
    this.time.value += delta;
    this.cheerLevel.value += (this.cheerTarget - this.cheerLevel.value) * Math.min(1, delta * 4);
    this.cheerTarget = Math.max(0, this.cheerTarget - delta * 0.25);
  }
}
