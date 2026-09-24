import * as THREE from "three";

export const HALF_LENGTH = 90;
export const HALF_WIDTH = 65;
const GOAL_HALF_WIDTH = 3.2;
const BEHIND_HALF_WIDTH = 9.6;
const LINE_Y = 0.05;

const lineMaterial = new THREE.LineBasicMaterial({ color: 0xffffff });

function insideOval(x: number, z: number): boolean {
  return (x / HALF_LENGTH) ** 2 + (z / HALF_WIDTH) ** 2 <= 1;
}

function line(points: THREE.Vector3[]): THREE.Line {
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), lineMaterial);
}

function ellipse(rx: number, rz: number, segments = 128): THREE.Line {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    points.push(new THREE.Vector3(Math.cos(a) * rx, LINE_Y, Math.sin(a) * rz));
  }
  return line(points);
}

function buildGround(): THREE.Mesh {
  const shape = new THREE.Shape();
  const segments = 96;
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const x = Math.cos(a) * (HALF_LENGTH + 6);
    const z = Math.sin(a) * (HALF_WIDTH + 6);
    if (i === 0) shape.moveTo(x, z);
    else shape.lineTo(x, z);
  }
  const geometry = new THREE.ShapeGeometry(shape, 96);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x2f7a3d, roughness: 0.9 }));
  mesh.receiveShadow = true;
  return mesh;
}

/** 50m arc: radius 50 from the centre of goal, clipped to the boundary. */
function fiftyArc(end: 1 | -1): THREE.Line {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= 90; i++) {
    const a = Math.PI / 2 + (i / 90) * Math.PI;
    const x = end * HALF_LENGTH + Math.cos(a) * 50 * end;
    const z = Math.sin(a) * 50;
    if (insideOval(x, z)) points.push(new THREE.Vector3(x, LINE_Y, z));
  }
  return line(points);
}

function goalSquare(end: 1 | -1): THREE.Line {
  const x0 = end * HALF_LENGTH;
  const x1 = end * (HALF_LENGTH - 9);
  return line([
    new THREE.Vector3(x0, LINE_Y, -GOAL_HALF_WIDTH),
    new THREE.Vector3(x1, LINE_Y, -GOAL_HALF_WIDTH),
    new THREE.Vector3(x1, LINE_Y, GOAL_HALF_WIDTH),
    new THREE.Vector3(x0, LINE_Y, GOAL_HALF_WIDTH),
  ]);
}

function centreSquare(): THREE.Line {
  const h = 25;
  return line([
    new THREE.Vector3(-h, LINE_Y, -h),
    new THREE.Vector3(h, LINE_Y, -h),
    new THREE.Vector3(h, LINE_Y, h),
    new THREE.Vector3(-h, LINE_Y, h),
    new THREE.Vector3(-h, LINE_Y, -h),
  ]);
}

function goals(end: 1 | -1): THREE.Group {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const x = end * HALF_LENGTH;
  for (const z of [-GOAL_HALF_WIDTH, GOAL_HALF_WIDTH]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 16, 10), material);
    post.position.set(x, 8, z);
    post.castShadow = true;
    group.add(post);
  }
  for (const z of [-BEHIND_HALF_WIDTH, BEHIND_HALF_WIDTH]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 9, 10), material);
    post.position.set(x, 4.5, z);
    post.castShadow = true;
    group.add(post);
  }
  group.add(line([new THREE.Vector3(x, LINE_Y, -BEHIND_HALF_WIDTH), new THREE.Vector3(x, LINE_Y, BEHIND_HALF_WIDTH)]));
  return group;
}

function stand(x: number, z: number, width: number, rotationY: number): THREE.Group {
  const group = new THREE.Group();
  const seating = new THREE.Mesh(new THREE.BoxGeometry(width, 12, 14), new THREE.MeshStandardMaterial({ color: 0x33414f }));
  seating.position.y = 6;
  seating.rotation.x = -0.35;
  group.add(seating);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(width, 1, 18), new THREE.MeshStandardMaterial({ color: 0xcfd6dd }));
  roof.position.set(0, 16, 2);
  group.add(roof);
  group.position.set(x, 0, z);
  group.rotation.y = rotationY;
  return group;
}

export function buildField(): THREE.Group {
  const group = new THREE.Group();
  group.add(buildGround());
  group.add(ellipse(HALF_LENGTH, HALF_WIDTH));
  group.add(ellipse(5, 5, 48));
  group.add(ellipse(1.5, 1.5, 24));
  group.add(centreSquare());
  for (const end of [1, -1] as const) {
    group.add(fiftyArc(end));
    group.add(goalSquare(end));
    group.add(goals(end));
  }
  // Grandstands ringing the oval.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const x = Math.cos(a) * (HALF_LENGTH + 24);
    const z = Math.sin(a) * (HALF_WIDTH + 24);
    group.add(stand(x, z, 60, -a - Math.PI / 2));
  }
  return group;
}
