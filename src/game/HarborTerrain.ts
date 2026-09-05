import * as THREE from 'three/webgpu';
import { color, float, mix, normalLocal, positionLocal, texture, triplanarTexture } from 'three/tsl';

const clamp = THREE.MathUtils.clamp;
const smooth = (a: number, b: number, x: number) => THREE.MathUtils.smoothstep(x, a, b);
function hash(x: number, z: number): number { const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123; return n - Math.floor(n); }
export function noise(x: number, z: number): number {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(hash(ix, iz), hash(ix + 1, iz), u), THREE.MathUtils.lerp(hash(ix, iz + 1), hash(ix + 1, iz + 1), u), v);
}
const coast: [number, number][] = [[-6000, 2300], [-2200, 2100], [-1600, 1450], [-1220, 400], [-880, -88], [650, -88], [950, -230], [1400, -730], [2800, -1050], [5200, -2400]];
export function westCoast(z: number): number {
  for (let i = 1; i < coast.length; i++) {
    if (z <= coast[i][0]) {
      const t = smooth(coast[i - 1][0], coast[i][0], z);
      return THREE.MathUtils.lerp(coast[i - 1][1], coast[i][1], t);
    }
  }
  return -2400;
}
export function coastDistance(x: number, z: number): number {
  const waviness = (noise(z / 160, 19) - .5) * 65 * smooth(700, 1050, Math.abs(z));
  const west = westCoast(z) - x + waviness;
  const north = -1630 - z + (noise(x / 380, 7) - .5) * 380;
  const eastEdge = 1630 + Math.max(0, z + 500) * .36 + Math.max(0, z - 900) * 1.6;
  const east = x - eastEdge + (noise(z / 240, 4) - .5) * 150;
  return Math.max(west, north, east);
}
function terrainProfileHeight(x: number, z: number): number {
  const inland = coastDistance(x, z);
  if (inland < 0) return Math.max(-28, inland * .32);
  const shore = smooth(0, 70, inland);
  const foothills = smooth(850, 2500, inland);
  const broad = noise(x / 900 + 1, z / 820 + 5);
  const ridges = 1 - Math.abs(noise(x / 500, z / 520) * 2 - 1);
  const detail = (noise(x / 115, z / 130) - .5) * 20 + (noise(x / 38, z / 38) - .5) * 4;
  let height = shore * (7 + foothills * (80 + broad * 330 + ridges * 75) + smooth(150, 850, inland) * detail);
  // Eroded hillside faces behind the town: narrow gullies cut through broken
  // rock shelves, while the engineered coastal terrace remains undisturbed.
  const hillFace = smooth(1250,1680,-x) * (1-smooth(2850,3450,-x)) * (1-smooth(1450,1900,Math.abs(z)));
  const channelA = -360 + (-x-1500)*.22 + (noise(x/270,29)-.5)*100;
  const channelB = 660 - (-x-1500)*.16 + (noise(x/320,57)-.5)*135;
  const gullies = Math.exp(-(((z-channelA)/42)**2)) + Math.exp(-(((z-channelB)/53)**2));
  const brokenRock = (noise(x/81,z/95)-.5)*46 + (noise(x/29,z/37)-.5)*14;
  height += hillFace * (brokenRock - gullies*46);
  // A low coastal town sits on a gentle terrace; the wooded mountains rise beyond it.
  const town = (1-smooth(1100,1480,-x)) * smooth(440,550,-x) * (1-smooth(870,1170,Math.abs(z)));
  const townGrade = 8 + Math.max(0,-x-500)*.064 + noise(x/460,z/470)*3;
  height = THREE.MathUtils.lerp(height,townGrade,town);
  // The main dock and street grid are engineered into the same continuous land mesh.
  const quay = (1 - smooth(490, 570, -x)) * (1 - smooth(690, 800, Math.abs(z))) * smooth(0, 15, inland);
  height = THREE.MathUtils.lerp(height, 6.2, quay);
  return height;
}

const terrainSize = 1000;
const terrainSegments = (quality: string) => quality === 'medium' ? 44 : 64;

/** Height of the visible triangle, so scenery shares the terrain's actual surface. */
export function terrainHeight(x: number, z: number, quality = 'high'): number {
  const segments = terrainSegments(quality), spacing = terrainSize / segments;
  const x0 = Math.floor(x / terrainSize) * terrainSize, z0 = Math.floor(z / terrainSize) * terrainSize;
  const ix = Math.min(segments - 1, Math.floor((x - x0) / spacing));
  const iz = Math.min(segments - 1, Math.floor((z - z0) / spacing));
  // PlaneGeometry stores local vertices and then translated vertices in float32.
  const coordinate = (origin: number, index: number) => Math.fround(Math.fround(index * spacing - terrainSize / 2) + origin + terrainSize / 2);
  const ax = coordinate(x0, ix), bx = coordinate(x0, ix + 1);
  const az = coordinate(z0, iz), bz = coordinate(z0, iz + 1);
  const u = (x - ax) / (bx - ax), v = (z - az) / (bz - az);
  const b = Math.fround(terrainProfileHeight(ax, bz)), d = Math.fround(terrainProfileHeight(bx, az));
  if (u + v <= 1) {
    const a = Math.fround(terrainProfileHeight(ax, az));
    return a + (d - a) * u + (b - a) * v;
  }
  const c = Math.fround(terrainProfileHeight(bx, bz));
  return c + (b - c) * (1 - u) + (d - c) * (1 - v);
}

export function createHarborTerrain(textures: Record<string, THREE.Texture>, quality: string): THREE.Group {
  const root = new THREE.Group(); root.name = 'Continuous coastal terrain';
  const material = new THREE.MeshStandardNodeMaterial({ roughness: .95, vertexColors: true });
  const grass = triplanarTexture(texture(textures['meadow-color']), null, null, float(1 / 32));
  const rock = triplanarTexture(texture(textures['rock-color']), null, null, float(1 / 36));
  const slope = normalLocal.y.smoothstep(.48, .76).oneMinus();
  const shoreline = positionLocal.y.smoothstep(3, 16).oneMinus();
  const stone = slope.max(shoreline.mul(.9));
  const macro = texture(textures['ground-color'], positionLocal.xz.mul(1 / 700)).rgb.mul(.3).add(.77);
  material.colorNode = mix(grass.rgb.mul(color('#8aa776')), rock.rgb.mul(color('#a2a69a')), stone).mul(macro);
  // Finely tessellated near shore; separate cells permit culling behind the camera.
  const size = terrainSize, segments = terrainSegments(quality);
  for (let cx = -5; cx < 6; cx++) for (let cz = -6; cz < 5; cz++) {
    const x0 = cx * size, z0 = cz * size;
    if (coastDistance(x0 + 500, z0 + 500) < -900) continue;
    const g = new THREE.PlaneGeometry(size, size, segments, segments); g.rotateX(-Math.PI / 2); g.translate(x0 + 500, 0, z0 + 500);
    const p = g.getAttribute('position'), uv = g.getAttribute('uv'); const colors = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), h = terrainProfileHeight(x, z); p.setY(i, h);
      uv.setXY(i, x / 48, z / 48);
      const n = noise(x / 310, z / 310);
      const forest = smooth(920,1350,-x)*(1-smooth(2600,3300,coastDistance(x,z)));
      const canopy = smooth(.22,.62,noise(x/220,z/210));
      const shade = clamp(.84 + n * .20 - forest * canopy*.4, 0, 1);
      colors.set([shade, shade, shade * .97], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3)); g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, material); mesh.receiveShadow = true; mesh.name = `Coast ${cx},${cz}`; root.add(mesh);
  }
  // The textures are retained explicitly so Game's standard disposal pass can release them.
  material.map = textures['meadow-color']; material.normalMap = textures['meadow-normal']; material.normalScale.set(.35, .35);
  return root;
}
