import * as THREE from "three";

const HALF_LENGTH = 90;
const HALF_WIDTH = 65;

function buildGround(): THREE.Mesh {
  const shape = new THREE.Shape();
  const segments = 64;
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const x = Math.cos(angle) * HALF_LENGTH;
    const z = Math.sin(angle) * HALF_WIDTH;
    if (i === 0) shape.moveTo(x, z);
    else shape.lineTo(x, z);
  }
  const geometry = new THREE.ShapeGeometry(shape, 64);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshStandardMaterial({ color: 0x2f7a3d, roughness: 0.9 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}

function buildBoundaryLine(): THREE.Line {
  const points: THREE.Vector3[] = [];
  const segments = 128;
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    points.push(new THREE.Vector3(Math.cos(angle) * (HALF_LENGTH - 0.5), 0.05, Math.sin(angle) * (HALF_WIDTH - 0.5)));
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({ color: 0xffffff });
  return new THREE.Line(geometry, material);
}

function buildCenterCircle(): THREE.Line {
  const points: THREE.Vector3[] = [];
  const segments = 64;
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    points.push(new THREE.Vector3(Math.cos(angle) * 10, 0.05, Math.sin(angle) * 10));
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  return new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xffffff }));
}

function buildGoals(x: number): THREE.Group {
  const group = new THREE.Group();
  const postMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });

  const goalPostGeo = new THREE.CylinderGeometry(0.25, 0.25, 16, 8);
  for (const z of [-3.2, 3.2]) {
    const post = new THREE.Mesh(goalPostGeo, postMaterial);
    post.position.set(x, 8, z);
    group.add(post);
  }

  const pointPostGeo = new THREE.CylinderGeometry(0.18, 0.18, 10, 8);
  for (const z of [-9.95, 9.95]) {
    const post = new THREE.Mesh(pointPostGeo, postMaterial);
    post.position.set(x, 5, z);
    group.add(post);
  }

  return group;
}

function buildStand(x: number, z: number, rotationY: number): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(40, 14, 10);
  const material = new THREE.MeshStandardMaterial({ color: 0x33414f });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, 7, z);
  mesh.rotation.y = rotationY;
  return mesh;
}

export function buildField(): THREE.Group {
  const group = new THREE.Group();
  group.add(buildGround());
  group.add(buildBoundaryLine());
  group.add(buildCenterCircle());
  group.add(buildGoals(HALF_LENGTH));
  group.add(buildGoals(-HALF_LENGTH));

  group.add(buildStand(0, HALF_WIDTH + 20, 0));
  group.add(buildStand(0, -HALF_WIDTH - 20, Math.PI));

  return group;
}

export { HALF_LENGTH, HALF_WIDTH };
