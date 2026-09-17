import * as THREE from 'three';

const FLOOR_VERTEX = `
varying vec2 vFloor;
void main() { vec4 world = modelMatrix * vec4(position, 1.); vFloor = world.xz; gl_Position = projectionMatrix * viewMatrix * world; }`;
// Screen-space anti-aliased lines: every fifth is major, the x = 0 line is left to the brass centerline.
const FLOOR_FRAGMENT = `
uniform float uStep, uFadeIn, uFadeOut;
uniform vec2 uCenter, uHalf;
uniform vec3 uColor;
varying vec2 vFloor;
float lines(vec2 cell, out float density) {
  vec2 width = fwidth(cell), distance = abs(fract(cell - .5) - .5) / max(width, vec2(1e-6));
  density = max(width.x, width.y);
  return 1. - min(min(distance.x, distance.y), 1.);
}
void main() {
  float minorDensity, majorDensity;
  float minor = lines(vFloor / uStep, minorDensity), major = lines(vFloor / (uStep * 5.), majorDensity);
  // A level fades out as its lines crowd together rather than shimmering into a grey sheet.
  minor *= (1. - smoothstep(.08, .25, minorDensity)) * step(1.5, abs(vFloor.x) / max(fwidth(vFloor.x), 1e-6));
  major *= 1. - smoothstep(.12, .35, majorDensity);
  vec2 q = abs(vFloor - uCenter) - uHalf;
  float outside = length(max(q, 0.)) + min(max(q.x, q.y), 0.);
  float alpha = max(minor * .16, major * .3) * (1. - smoothstep(uFadeIn, uFadeOut, outside));
  if (alpha < .002) discard;
  gl_FragColor = vec4(uColor, alpha);
  #include <colorspace_fragment>
}`;

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
  // The floor plane runs far past this rectangle, so framing reads the datum rectangle instead of the mesh bounds.
  group.userData.frame = new THREE.Box3(new THREE.Vector3(x0, group.position.y, z0), new THREE.Vector3(x1, group.position.y, z1));
  const center = bounds.getCenter(new THREE.Vector3()), half = bounds.getSize(new THREE.Vector3()).multiplyScalar(.5);
  // Lines start fading at the old rectangle's edge and are gone about one hull length further out.
  const fadeOut = padding + extent * 1.1;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
    vertexShader: FLOOR_VERTEX, fragmentShader: FLOOR_FRAGMENT, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: {
      uStep: { value: step }, uFadeIn: { value: padding }, uFadeOut: { value: fadeOut },
      uCenter: { value: new THREE.Vector2(center.x, center.z) }, uHalf: { value: new THREE.Vector2(half.x, half.z) },
      uColor: { value: new THREE.Color('#bacbd0') },
    },
  }));
  floor.name = 'Construction floor'; floor.rotation.x = -Math.PI / 2; floor.renderOrder = -1;
  floor.scale.set(half.x * 2 + fadeOut * 2, half.z * 2 + fadeOut * 2, 1); floor.position.set(center.x, 0, center.z);
  group.add(floor);
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
