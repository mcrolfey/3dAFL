import * as THREE from "three";
import { block, voxelGeometry, type Voxel } from "./voxel.js";

/** Size of one voxel in meters — a footballer is 44 voxels tall (~1.94m). */
export const VOXEL = 0.044;
export const PLAYER_HEIGHT = 44 * VOXEL;

type Pattern = "hoops" | "stripes" | "vee" | "sash" | "yoke";
type HairStyle = "short" | "mullet" | "buzz" | "long" | "curly";

export interface Kit {
  primary: string;
  secondary: string;
  shorts: string;
  /** stripe down the side of the shorts; always contrasts with them */
  trim: string;
  pattern: Pattern;
}

interface Look {
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  beard: boolean;
  boots: string;
  wristTape: boolean;
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
const HAIR_STYLES: HairStyle[] = ["short", "short", "mullet", "buzz", "long", "curly"];
const BOOTS = ["#151515", "#151515", "#151515", "#f0f0f0", "#c6f432", "#ff6a13", "#2f7bff"];

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
    trim: light ? color : "#f4f4f4",
    pattern: PATTERNS[hash(teamName) % PATTERNS.length],
  };
}

function lookFor(seed: number): Look {
  const rand = seeded(seed);
  const pick = <T>(options: T[]) => options[Math.floor(rand() * options.length)];
  return {
    skin: pick(SKIN),
    hair: pick(HAIR),
    hairStyle: pick(HAIR_STYLES),
    beard: rand() < 0.3,
    boots: pick(BOOTS),
    wristTape: rand() < 0.35,
  };
}

// --- voxel models, each in its own grid with x = forward, y = up, z = across ---

/** 3x5 pixel font for the number on the back of the guernsey. */
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

function legVoxels(kit: Kit, look: Look): Voxel[] {
  const darkBoots = luminance(look.boots) < 0.3;
  const sole = darkBoots ? "#0b0b0b" : darken(look.boots, 0.35);
  const accent = darkBoots ? "#e8e8e8" : "#151515";
  const laces = darkBoots ? "#d8d8d8" : "#2a2a2a";
  return [
    // Boot: sole, toe cap out front, laces up the front, a stripe down each side.
    ...block([0, 0, 0], [4, 0, 3], () => sole),
    ...block([0, 1, 0], [4, 1, 3], () => look.boots),
    ...block([0, 2, 0], [3, 3, 3], (x, y, z) =>
      x === 3 && (z === 1 || z === 2) ? laces : (z === 0 || z === 3) && y === 2 && x >= 1 && x <= 2 ? accent : look.boots,
    ),
    // Socks, with the club band at the top and a bit of calf.
    ...block([0, 4, 0], [3, 11, 3], (_x, y) => (y >= 10 ? kit.secondary : kit.primary)),
    ...block([-1, 6, 1], [-1, 9, 2], () => kit.primary),
    // Knee and thigh, shaded darker where the shorts overhang.
    ...block([0, 12, 0], [3, 17, 3], (x, y) => (y >= 16 ? darken(look.skin, 0.18) : x === 3 && y === 13 ? darken(look.skin, 0.07) : look.skin)),
  ];
}

function guernsey(kit: Kit, x: number, row: number, z: number): string {
  const s = kit.secondary;
  const p = kit.primary;
  switch (kit.pattern) {
    case "hoops":
      return Math.floor(row / 2) % 2 === 1 && row < 10 ? s : p;
    case "stripes":
      return Math.floor(z / 2) % 2 === 1 ? s : p;
    case "vee":
      return x === 5 && row >= 4 && Math.abs(Math.abs(z - 4.5) - (row - 4) * 0.65) < 0.9 ? s : p;
    case "sash":
      return (x === 5 || x === 0) && Math.abs(z - row * 0.8 - 0.5) < 1.3 ? s : p;
    case "yoke":
      return row >= 8 ? s : p;
  }
}

/** The back number's pixels, keyed "row from the top,column across the back". */
function backNumber(num: number): Set<string> {
  const text = String(num);
  const width = text.length * 4 - 1;
  const left = Math.floor((10 - width) / 2);
  const pixels = new Set<string>();
  [...text].forEach((digit, i) =>
    DIGITS[digit].forEach((row, r) => [...row].forEach((bit, c) => bit === "1" && pixels.add(`${r},${left + i * 4 + c}`))),
  );
  return pixels;
}

function torsoVoxels(kit: Kit, num: number): Voxel[] {
  const number = backNumber(num);
  // Rows 0-5 are shorts, 6-17 the (sleeveless) guernsey: narrower at the waist, broad across the shoulders.
  const colorAt = (x: number, y: number, z: number) => {
    if (y <= 5) {
      if ((z === 0 || z === 9) && (x === 2 || x === 3)) return kit.trim;
      return y === 0 ? darken(kit.shorts, 0.15) : kit.shorts;
    }
    const row = y - 6;
    if (y === 17 && x >= 1 && x <= 4 && z >= 3 && z <= 6) return kit.secondary; // collar
    if (x === 0 && row >= 3 && row <= 9 && z >= 1 && z <= 8) {
      // Number panel on the back: the number in the contrast colour on a plain panel.
      return number.has(`${8 - row},${z}`) ? kit.secondary : kit.primary;
    }
    return guernsey(kit, x, row, z);
  };
  return [...block([0, 0, 0], [5, 5, 9], colorAt), ...block([0, 6, 1], [5, 8, 8], colorAt), ...block([0, 9, 0], [5, 17, 9], colorAt)];
}

function armVoxels(kit: Kit, look: Look): Voxel[] {
  return [
    ...block([0, 0, 0], [2, 13, 2], (_x, y) =>
      y >= 12 ? kit.primary : y <= 2 ? darken(look.skin, 0.08) : y === 3 && look.wristTape ? "#efefef" : look.skin,
    ),
    [3, 1, 1, darken(look.skin, 0.08)], // thumb
  ];
}

function headVoxels(look: Look): Voxel[] {
  const hairAt = (x: number, h: number, z: number) => {
    const side = z === 0 || z === 7;
    switch (look.hairStyle) {
      case "buzz":
        return h === 6 || (x <= 1 && h >= 5);
      case "short":
      case "curly":
        return h === 6 || (x <= 2 && h >= 3) || (side && h >= 5 && x <= 5);
      case "mullet":
        return h === 6 || x === 0 || (x <= 2 && h >= 3) || (side && h >= 5 && x <= 5);
      case "long":
        return h === 6 || x <= 2 || (side && x <= 5 && h >= 1);
    }
  };
  // Chin and jawline, leaving the mouth clear.
  const beardAt = (x: number, h: number, z: number) =>
    look.beard && ((x === 7 && h <= 1 && !(h === 1 && (z === 3 || z === 4))) || ((z === 0 || z === 7) && x >= 4 && h <= 3));
  const brow = darken(look.hair, 0.2);
  const face = (h: number, z: number): string | null => {
    if ((h === 3 || h === 4) && (z === 2 || z === 5)) return "#161616"; // eyes
    if (h === 5 && (z === 1 || z === 2 || z === 5 || z === 6)) return brow;
    if (h === 1 && (z === 3 || z === 4)) return "#7a3b30"; // mouth
    return null;
  };

  const voxels: Voxel[] = [
    ...block([2, 0, 2], [5, 0, 5], () => darken(look.skin, 0.15)), // neck, in the shadow of the chin
    ...block([0, 1, 0], [7, 7, 7], (x, y, z) => {
      const h = y - 1;
      if (hairAt(x, h, z) || beardAt(x, h, z)) return look.hair;
      if (x === 7) return face(h, z) ?? (h === 0 ? darken(look.skin, 0.06) : look.skin);
      return look.skin;
    }),
    [8, 3, 3, darken(look.skin, 0.1)], // nose
    [8, 3, 4, darken(look.skin, 0.1)],
  ];
  if (look.hairStyle !== "long") {
    for (const z of [-1, 8]) voxels.push(...block([3, 3, z], [4, 5, z], () => darken(look.skin, 0.05))); // ears
  }
  if (look.hairStyle === "mullet") voxels.push(...block([-1, 0, 2], [-1, 4, 5], () => look.hair));
  if (look.hairStyle === "curly") {
    for (let x = 0; x <= 6; x++) for (let z = 1; z <= 6; z++) if ((x + z) % 2 === 0) voxels.push([x, 8, z, look.hair]);
  }
  return voxels;
}

/** Builds one pixel-art footballer. Geometry is cached by what it depends on, so teammates share where they can. */
export function buildFootballer(
  kit: Kit,
  playerId: string,
  number: number,
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

  const legGeo = geometry(`leg|${kitKey}|${look.skin}|${look.boots}`, () => voxelGeometry(legVoxels(kit, look), VOXEL, [2, 18, 2]));
  const armGeo = geometry(`arm|${kitKey}|${look.skin}|${look.wristTape}`, () => voxelGeometry(armVoxels(kit, look), VOXEL, [1.5, 14, 1.5]));
  const torsoGeo = geometry(`torso|${kitKey}|${number}`, () => voxelGeometry(torsoVoxels(kit, number), VOXEL, [3, 0, 5]));
  const headGeo = geometry(`head|${look.skin}|${look.hair}|${look.hairStyle}|${look.beard}`, () =>
    voxelGeometry(headVoxels(look), VOXEL, [4, 0, 4]),
  );

  const limb = (g: THREE.BufferGeometry, x: number, y: number, z: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(x * VOXEL, y * VOXEL, z * VOXEL);
    pivot.add(mesh(g));
    return pivot;
  };

  const body = new THREE.Group();
  const leftLeg = limb(legGeo, 0, 18, -2.5);
  const rightLeg = limb(legGeo, 0, 18, 2.5);
  const leftArm = limb(armGeo, 0, 36, -6.5);
  const rightArm = limb(armGeo, 0, 36, 6.5);
  const torso = mesh(torsoGeo);
  torso.position.y = 18 * VOXEL;
  const head = mesh(headGeo);
  head.position.y = 36 * VOXEL;
  body.add(leftLeg, rightLeg, leftArm, rightArm, torso, head);

  const root = new THREE.Group();
  root.add(body);
  return { root, body, leftArm, rightArm, leftLeg, rightLeg };
}
