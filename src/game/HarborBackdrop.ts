/** Lightweight, illustrative harbor scenery for the port preview. No collision or gameplay. */
import * as THREE from 'three/webgpu';

export function createHarborBackdrop(): THREE.Group {
  const harbor = new THREE.Group();
  harbor.name = 'Port preview scenery';
  const concrete = new THREE.MeshStandardMaterial({ color: '#6e7572', roughness: .98 });
  const edge = new THREE.MeshStandardMaterial({ color: '#98988c', roughness: .92 });
  const wall = new THREE.MeshStandardMaterial({ color: '#686d69', roughness: .9 });
  const roof = new THREE.MeshStandardMaterial({ color: '#414d53', roughness: .8 });
  const steel = new THREE.MeshStandardMaterial({ color: '#4d6065', metalness: .45, roughness: .65 });
  const dark = new THREE.MeshStandardMaterial({ color: '#252e32', roughness: .8 });
  const rust = new THREE.MeshStandardMaterial({ color: '#807057', roughness: .85 });
  const lamp = new THREE.MeshBasicMaterial({ color: '#ead7a3' });
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const beamGeometry = new THREE.CylinderGeometry(1, 1, 1, 6);
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material = concrete) => {
    const mesh = new THREE.Mesh(boxGeometry, material);
    mesh.scale.set(w, h, d); mesh.position.set(x, y, z);
    mesh.receiveShadow = true; mesh.castShadow = true; harbor.add(mesh);
    return mesh;
  };
  const beam = (a: THREE.Vector3, b: THREE.Vector3, thickness = .7) => {
    const mesh = new THREE.Mesh(beamGeometry, steel);
    mesh.scale.set(thickness, a.distanceTo(b), thickness);
    mesh.position.copy(a).add(b).multiplyScalar(.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    mesh.castShadow = true; harbor.add(mesh);
  };
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  box(410, 20, 1300, -305, -5, 0);
  box(8, 2, 1300, -96, 6, 0, edge);
  box(500, 14, 130, 50, -2, -690);
  // Quay seams, rail lines, bollards, fenders and lamps establish the ship's scale.
  for (let z = -580; z <= 580; z += 40) {
    box(180, .05, .25, -195, 5.04, z, dark);
    box(2, 2.8, 2, -95, 8, z, dark);
    box(3.8, 1.1, 1.8, -95, 9.2, z, dark);
    box(2, 7, 4, -91, 1.5, z + 16, dark);
  }
  box(.65, .15, 1200, -113, 5.2, 0, steel);
  box(.65, .15, 1200, -120, 5.2, 0, steel);
  for (let z = -500; z <= 500; z += 125) {
    box(.6, 18, .6, -127, 14, z, steel);
    box(5, .6, .7, -124.7, 23, z, steel);
    box(2, .5, 1.1, -122.8, 22.5, z, lamp);
  }
  for (const [x, z, length] of [[-244,-365,180],[-260,-80,155],[-246,190,145],[-280,440,140]]) {
    box(98, 29, length, x, 19.5, z, wall);
    box(112, 3, length + 6, x, 35, z, roof);
    for (let offset = -length / 2 + 13; offset < length / 2; offset += 26) {
      box(.5, 14, 17, x + 49.3, 13, z + offset, dark);
      box(.5, 3, 17, x + 49.8, 29, z + offset, edge);
    }
  }
  for (let i = 0; i < 15; i++) {
    const z = -400 + i * 59;
    box(11, 7, 19, -151 - (i % 3) * 16, 8.5, z, i % 2 ? rust : steel);
    if (i % 3 === 0) box(11, 7, 19, -151, 15.5, z, steel);
  }
  for (const z of [-240, 255]) {
    const x = -104;
    for (const side of [-1, 1]) {
      beam(v(x - 13, 5, z + side * 12), v(x - 7, 48, z + side * 7), 1.1);
      beam(v(x + 13, 5, z + side * 12), v(x + 7, 48, z + side * 7), 1.1);
      for (let h = 5; h < 45; h += 10) {
        beam(v(x - 11, h, z + side * 10), v(x + 10, h + 10, z + side * 9), .38);
        beam(v(x + 11, h, z + side * 10), v(x - 10, h + 10, z + side * 9), .38);
      }
    }
    box(21, 8, 19, x, 50, z, steel);
    box(8, 7, 10, x + 9, 56, z, edge);
    for (const dz of [-3, 3]) {
      beam(v(x - 35, 56, z + dz), v(x + 88, 65, z + dz), .65);
      beam(v(x - 35, 62, z + dz), v(x + 88, 70, z + dz), .65);
      for (let j = 0; j < 12; j++) {
        const bx = x - 35 + j * 10;
        beam(v(bx, 56 + j * .73, z + dz), v(bx + 10, 62 + (j + 1) * .65, z + dz), .3);
      }
    }
    beam(v(x + 75, 65, z), v(x + 75, 23, z), .12);
    box(2, 2.5, 2, x + 75, 22, z, dark);
    box(18, 12, 17, x - 28, 57, z, concrete);
  }
  return harbor;
}
