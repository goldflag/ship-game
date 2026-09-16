import * as THREE from 'three';

/** A visual datum only: never included in the editor's placement/picking targets. */
export function createBuilderGrid(bounds: THREE.Box3, snapStep: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Construction floor grid';
  const size = bounds.getSize(new THREE.Vector3());
  const extent = Math.max(10, size.x, size.z), padding = Math.max(4, extent * .16);
  // Keep large ships legible and line counts bounded, even at the finest snap setting.
  const gridExtent = Math.max(extent, Math.max(bounds.max.x, 0) - Math.min(bounds.min.x, 0));
  const step = snapStep * Math.max(1, Math.ceil((gridExtent + padding * 2) / (100 * snapStep)));
  const x0 = Math.floor((Math.min(bounds.min.x, 0) - padding) / step) * step;
  const x1 = Math.ceil((Math.max(bounds.max.x, 0) + padding) / step) * step;
  const z0 = Math.floor((bounds.min.z - padding) / step) * step;
  const z1 = Math.ceil((bounds.max.z + padding) / step) * step;
  group.position.y = bounds.min.y - Math.max(.5, extent * .015);
  const minor: number[] = [], major: number[] = [];
  for (let i = Math.round(x0 / step); i <= Math.round(x1 / step); i++) {
    if (i !== 0) (i % 5 === 0 ? major : minor).push(i * step, 0, z0, i * step, 0, z1);
  }
  for (let i = Math.round(z0 / step); i <= Math.round(z1 / step); i++) {
    (i % 5 === 0 ? major : minor).push(x0, 0, i * step, x1, 0, i * step);
  }
  for (const [vertices, opacity] of [[minor, .16], [major, .3]] as const) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    group.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: '#bacbd0', transparent: true, opacity, depthWrite: false })));
  }
  const brass = new THREE.MeshBasicMaterial({ color: '#e0c58d', side: THREE.DoubleSide });
  const width = Math.max(.045, extent * .0015);
  const centerline = new THREE.Mesh(new THREE.PlaneGeometry(width, z1 - z0), brass);
  centerline.name = 'Ship centerline'; centerline.rotation.x = -Math.PI / 2;
  centerline.position.set(0, .015, (z0 + z1) / 2); group.add(centerline);
  // Filled chevrons keep the forward direction readable at oblique angles. Bow is −Z.
  const arrowSize = Math.max(.5, extent * .025), arrows: number[] = [];
  const spacing = Math.max(3, extent / 6);
  for (let z = z0 + arrowSize * 1.5; z < z1 - arrowSize; z += spacing) {
    arrows.push(0, .025, z - arrowSize, -arrowSize * .6, .025, z,
      0, .025, z - arrowSize * .35,
      0, .025, z - arrowSize, 0, .025, z - arrowSize * .35,
      arrowSize * .6, .025, z);
  }
  const arrowGeometry = new THREE.BufferGeometry();
  arrowGeometry.setAttribute('position', new THREE.Float32BufferAttribute(arrows, 3));
  const markers = new THREE.Mesh(arrowGeometry, brass); markers.name = 'Bow direction markers'; group.add(markers);
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 80;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#e0c58d'; context.font = '500 48px Barlow, sans-serif';
  context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText('BOW', 128, 40);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthWrite: false }));
  label.name = 'Bow label'; label.position.set(0, .15, z0 - arrowSize);
  label.scale.set(arrowSize * 3.5, arrowSize * 3.5 * 80 / 256, 1); group.add(label);
  return group;
}
