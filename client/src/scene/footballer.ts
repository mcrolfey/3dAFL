import * as THREE from "three";
import { block, voxelGeometry, type Voxel } from "./voxel.js";

/** Size of one voxel in meters — a footballer is 22 voxels tall (~1.95m). */
export const VOXEL = 0.088;

type Pattern = "hoops" | "stripes" | "vee" | "sash" | "yoke";
type HairStyle = "short" | "mullet" | "buzz" | "long";

export interface Kit {
  primary: string;
  secondary: string;
  shorts: string;
  pattern: Pattern;
}

interface Look {
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  boots: string;
}

export interface Footballer {
  root: THREE.Group;
  body: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
}

const PATTERNS: Pattern[] = ["hoops", "stripes", "vee", "sash", "yoke"];
const SKIN = ["#f1c7a3", "#e3b08c", "#c9906a", "#a86d4b", "#7c4d35", "#5c3a28"];
const HAIR = ["#2b1d14", "#4a3020", "#7a5230", "#c79a58", "#e5c77e", "#141414", "#8a3b1c"];
const HAIR_STYLES: HairStyle[] = ["short", "short", "mullet", "buzz", "long"];

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Small deterministic PRNG so each player keeps the same look every time they're drawn. */
function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function luminance(hex: string): number {
  const c = new THREE.Color(hex);
  const [r, g, b] = [c.r, c.g, c.b].map((v) => THREE.MathUtils.clamp(Math.pow(v, 1 / 2.2), 0, 1));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function darken(hex: string, amount: number): string {
  return `#${new THREE.Color(hex).multiplyScalar(1 - amount).getHexString()}`;
}

export function kitFor(teamName: string, color: string): Kit {
  const light = luminance(color) > 0.5;
  return {
    primary: color,
    secondary: light ? "#1c1c1c" : "#f4f4f4",
    shorts: light ? "#18181c" : darken(color, 0.45),
    pattern: PATTERNS[hash(teamName) % PATTERNS.length],
  };
}

function lookFor(seed: number): Look {
  const rand = seeded(seed);
  const pick = <T>(options: T[]) => options[Math.floor(rand() * options.length)];
  return { skin: pick(SKIN), hair: pick(HAIR), hairStyle: pick(HAIR_STYLES), boots: rand() < 0.8 ? "#151515" : "#f0f0f0" };
}

// --- voxel models, each in its own grid with x = forward, y = up, z = across ---

function legVoxels(kit: Kit, look: Look): Voxel[] {
  return [
    ...block([0, 0, 0], [1, 8, 1], (_x, y) => (y <= 1 ? look.boots : y <= 5 ? (y === 5 ? kit.secondary : kit.primary) : look.skin)),
    ...block([2, 0, 0], [2, 0, 1], () => look.boots), // toe of the boot
  ];
}

function guernsey(kit: Kit, x: number, row: number, z: number): string {
  const s = kit.secondary;
  const p = kit.primary;
  switch (kit.pattern) {
    case "hoops":
      return row === 1 || row === 3 ? s : p;
    case "stripes":
      return z % 2 === 1 ? s : p;
    case "vee":
      return x === 2 && row >= 2 && Math.abs(z - 2) === row - 2 ? s : p;
    case "sash":
      return (x === 2 || x === 0) && (z - row === 0 || z - row === -1) ? s : p;
    case "yoke":
      return row >= 4 ? s : p;
  }
}

function torsoVoxels(kit: Kit): Voxel[] {
  // Rows 0-2 are shorts, 3-8 the (sleeveless) guernsey.
  return block([0, 0, 0], [2, 8, 4], (x, y, z) => (y <= 2 ? kit.shorts : guernsey(kit, x, y - 3, z)));
}

function armVoxels(kit: Kit, look: Look): Voxel[] {
  return block([0, 0, 0], [1, 6, 1], (_x, y) => (y === 6 ? kit.primary : look.skin));
}

function headVoxels(look: Look): Voxel[] {
  const hairAt = (x: number, y: number) => {
    switch (look.hairStyle) {
      case "buzz":
        return y === 3;
      case "short":
        return y === 3 || (x === 0 && y >= 2);
      case "mullet":
        return y === 3 || x === 0;
      case "long":
        return y === 3 || x === 0 || (x <= 1 && y >= 1);
    }
  };
  const voxels = block([0, 0, 0], [3, 3, 3], (x, y) => (hairAt(x, y) ? look.hair : look.skin));
  if (look.hairStyle === "mullet") voxels.push(...block([-1, -1, 1], [-1, 1, 2], () => look.hair));
  voxels.push([4, 2, 1, "#1a1a1a"], [4, 2, 2, "#1a1a1a"]); // eyes sit one voxel proud of the face so they read at a distance
  return voxels;
}

/** Builds one pixel-art footballer. Geometry is cached by what it depends on, so teammates share where they can. */
export function buildFootballer(
  kit: Kit,
  playerId: string,
  material: THREE.Material,
  cache: Map<string, THREE.BufferGeometry>,
): Footballer {
  const look = lookFor(hash(playerId));
  const geometry = (key: string, make: () => THREE.BufferGeometry) => {
    let g = cache.get(key);
    if (!g) {
      g = make();
      cache.set(key, g);
    }
    return g;
  };
  const mesh = (g: THREE.BufferGeometry) => {
    const m = new THREE.Mesh(g, material);
    m.castShadow = true;
    return m;
  };
  const kitKey = `${kit.primary}|${kit.pattern}`;

  const legGeo = geometry(`leg|${kitKey}|${look.skin}|${look.boots}`, () => voxelGeometry(legVoxels(kit, look), VOXEL, [1, 9, 1]));
  const armGeo = geometry(`arm|${kitKey}|${look.skin}`, () => voxelGeometry(armVoxels(kit, look), VOXEL, [1, 7, 1]));
  const torsoGeo = geometry(`torso|${kitKey}`, () => voxelGeometry(torsoVoxels(kit), VOXEL, [1.5, 0, 2.5]));
  const headGeo = geometry(`head|${look.skin}|${look.hair}|${look.hairStyle}`, () => voxelGeometry(headVoxels(look), VOXEL, [2, 0, 2]));

  const limb = (g: THREE.BufferGeometry, x: number, y: number, z: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(x * VOXEL, y * VOXEL, z * VOXEL);
    pivot.add(mesh(g));
    return pivot;
  };

  const body = new THREE.Group();
  const leftLeg = limb(legGeo, 0, 9, -1);
  const rightLeg = limb(legGeo, 0, 9, 1);
  const leftArm = limb(armGeo, 0, 18, -3.5);
  const rightArm = limb(armGeo, 0, 18, 3.5);
  const torso = mesh(torsoGeo);
  torso.position.y = 9 * VOXEL;
  const head = mesh(headGeo);
  head.position.y = 18 * VOXEL;
  body.add(leftLeg, rightLeg, leftArm, rightArm, torso, head);

  const root = new THREE.Group();
  root.add(body);
  return { root, body, leftArm, rightArm, leftLeg, rightLeg };
}
