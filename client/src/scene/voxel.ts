import * as THREE from "three";

/** A voxel at integer grid coordinates with an sRGB hex colour. x = forward, y = up, z = across. */
export type Voxel = [x: number, y: number, z: number, color: string];

const FACES: { dir: [number, number, number]; corners: [number, number, number][] }[] = [
  { dir: [1, 0, 0], corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { dir: [-1, 0, 0], corners: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
  { dir: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { dir: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { dir: [0, 0, 1], corners: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]] },
  { dir: [0, 0, -1], corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
];

/**
 * Merges voxels into one mesh, emitting only faces that aren't hidden by a neighbour, with a touch of per-voxel
 * colour noise for a hand-pixelled look. `pivot` (in voxel units) becomes the geometry's origin — e.g. a hip or shoulder.
 */
export function voxelGeometry(voxels: Voxel[], size: number, pivot: [number, number, number]): THREE.BufferGeometry {
  const occupied = new Set(voxels.map(([x, y, z]) => `${x},${y},${z}`));
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const color = new THREE.Color();

  for (const [x, y, z, hex] of voxels) {
    color.set(hex).multiplyScalar(0.94 + Math.random() * 0.12);
    for (const face of FACES) {
      if (occupied.has(`${x + face.dir[0]},${y + face.dir[1]},${z + face.dir[2]}`)) continue;
      const base = positions.length / 3;
      for (const [cx, cy, cz] of face.corners) {
        positions.push((x + cx - pivot[0]) * size, (y + cy - pivot[1]) * size, (z + cz - pivot[2]) * size);
        normals.push(...face.dir);
        colors.push(color.r, color.g, color.b);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  return geometry;
}

/** Fills an axis-aligned block of voxels, colouring each with `colorAt`. */
export function block(
  [x0, y0, z0]: [number, number, number],
  [x1, y1, z1]: [number, number, number],
  colorAt: (x: number, y: number, z: number) => string,
): Voxel[] {
  const out: Voxel[] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) out.push([x, y, z, colorAt(x, y, z)]);
  return out;
}
