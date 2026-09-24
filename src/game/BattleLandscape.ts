/** The land of a battle map: its baked real-world heightfield drawn as continuous-level-of-detail terrain.
 *
 * `createBattleLandscape` builds everything the land needs from the decoded field at once (heights, gradients,
 * surface attributes and the sun's visibility; about 150 ms for a 2401² chart) and returns a view whose root the
 * game adds to its scene. `update` runs every frame and is cheap: it follows the scene's sun, recomputing the land's
 * own shadows only when the light has moved. The patches to draw are chosen as the terrain renders, for the camera
 * that renders it (`TerrainLod`). Open-sea maps have no field and return an empty view.
 *
 * See `src/game/terrain/` and the rendering section of assets/maps/terrain-notes.md. */
import * as THREE from 'three/webgpu';
import type { OceanMap } from '../maps/catalog';
import type { Heightfield, PlacedTerrain } from '../maps/heightfield';
import type { TerrainQuality } from './graphicsSettings';
import { coarseGrid, gradientHalves, heightBounds, sampleHeights, sunVisibility, surfaceAttributes } from './terrain/TerrainField';
import { PATCH_FLOATS, PATCH_QUADS, TerrainLod, type LodSettings, type LodView } from './terrain/TerrainLod';
import { SkyBake } from './terrain/TerrainBake';
import { TreeMaterial, treeGeometry } from './terrain/TerrainTrees';
import { treeAtlasTexture } from './terrain/TreeAtlas';
import { TerrainMaterial, type TerrainMaps } from './terrain/TerrainMaterial';
import type { LandStyle, SurfaceStyle } from './terrain/TerrainSurface';
import { attributeTexture, detailTexture, gradientTexture, heightTexture, noiseTexture, sunTexture } from './terrain/TerrainTextures';

export interface BattleLandscapeView {
  readonly root: THREE.Group;
  update(camera: THREE.PerspectiveCamera): void;
  dispose(): void;
}

/** Level-0 vertex spacing, the on-screen triangle edge the level ranges aim for, whether trees stand on the land and
 * whether the surface draws its finest detail (leaf clumps, streaks, froth, small relief), per terrain setting. */
export const TERRAIN_LOD: Readonly<Record<TerrainQuality, LodSettings & { trees: boolean; detailed: boolean }>> = {
  high: { spacing: 20, targetPixels: 5, trees: true, detailed: true },
  medium: { spacing: 40, targetPixels: 9, trees: false, detailed: false },
};
/** Patches the instance buffer holds; a selection rarely needs a fifth of them. */
const PATCH_CAPACITY = 6144;
/** The attributes' grid takes every second sample: they vary over hundreds of metres. */
const ATTRIBUTE_STRIDE = 2;
/** Sun movement (radians) that recomputes the land's shadows: about 0.3°. */
const SUN_TOLERANCE = .005;

/** The patch every instance draws: (PATCH_QUADS + 1)² vertices at integer grid coordinates, triangulated with every
 * diagonal from (i, j) to (i + 1, j + 1), which the morph collapses onto the coarser grid's diagonals. */
export function patchGeometry(capacity = PATCH_CAPACITY): THREE.InstancedBufferGeometry {
  const n = PATCH_QUADS, positions = new Float32Array((n + 1) * (n + 1) * 3), normals = new Float32Array(positions.length), indices: number[] = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const at = (j * (n + 1) + i) * 3;
    positions[at] = i; positions[at + 2] = j; normals[at + 1] = 1;
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
    indices.push(a, c, d, a, d, b);
  }
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  const patches = new THREE.InstancedBufferAttribute(new Float32Array(capacity * PATCH_FLOATS), PATCH_FLOATS);
  patches.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('terrainPatch', patches);
  geometry.instanceCount = 0;
  return geometry;
}

/** The authored sun of a map (compass azimuth 0 toward +z, 90 toward +x), until the scene's own light is found. */
function authoredSun(map: OceanMap): THREE.Vector3 {
  const elevation = THREE.MathUtils.degToRad(map.sky.elevation), azimuth = THREE.MathUtils.degToRad(map.sky.azimuth);
  return new THREE.Vector3(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.cos(azimuth) * Math.cos(elevation));
}

const STYLES: readonly LandStyle[] = ['tropical', 'snow', 'volcanic', 'chalk', 'rock'];
function surfaceStyle(map: OceanMap): SurfaceStyle {
  const land = map.land as OceanMap['land'] & { style: string };
  const style = STYLES.includes(land.style as LandStyle) ? land.style as LandStyle : 'rock';
  // The maps with seasons are northern (Norway, the Channel): the equator lies true south, (sin B, cos B) on a chart
  // whose top has true bearing B. The tropical maps take no aspect.
  const bearing = THREE.MathUtils.degToRad(map.bearing ?? 0), seasonal = style === 'snow' || style === 'chalk';
  return { style, shore: land.shore, low: land.low, high: land.high, equator: seasonal ? [Math.sin(bearing), Math.cos(bearing)] : [0, 0] };
}

const emptyView = (root: THREE.Group): BattleLandscapeView => ({ root, update() {}, dispose() { root.removeFromParent(); } });

export function createBattleLandscape(map: OceanMap, terrain: PlacedTerrain, quality: TerrainQuality): BattleLandscapeView {
  const root = new THREE.Group();
  root.name = `${map.name} terrain`;
  return terrain.field ? new HeightfieldLandscape(root, map, terrain.field, terrain.offset, quality) : emptyView(root);
}

const frustum = new THREE.Frustum(), projection = new THREE.Matrix4(), size = new THREE.Vector2(), light = new THREE.Vector3();

class HeightfieldLandscape implements BattleLandscapeView {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, TerrainMaterial>;
  /** Trees on the level-0 patches with land; absent at the medium terrain setting. */
  readonly trees?: THREE.Mesh<THREE.InstancedBufferGeometry, TreeMaterial>;
  private readonly treeAtlas?: THREE.Texture;
  private readonly lod: TerrainLod;
  /** The camera, projection and viewport the patches were last chosen for. */
  private readonly selected = { camera: new Float32Array(32), height: 0 };
  private readonly heights: Float32Array;
  private readonly sunBytes: Uint8Array<ArrayBuffer>;
  private readonly sun = new THREE.Vector3();
  private readonly maps: TerrainMaps;
  private readonly skyBake: SkyBake;
  private sunLight?: THREE.DirectionalLight;
  private disposed = false;

  constructor(readonly root: THREE.Group, map: OceanMap, readonly field: Heightfield, readonly offset: readonly [number, number], quality: TerrainQuality) {
    const settings = TERRAIN_LOD[quality];
    const heights = this.heights = sampleHeights(field);
    const coarse = coarseGrid(field, heights, ATTRIBUTE_STRIDE);
    const [minX, minZ, maxX, maxZ] = field.bounds();
    this.lod = new TerrainLod({ originX: minX, originZ: minZ, width: maxX - minX, depth: maxZ - minZ, cell: field.cell,
      bounds: heightBounds(field, heights, 8) }, settings);
    this.sun.copy(authoredSun(map));
    this.sunBytes = sunVisibility(field, heights, this.sun.toArray());
    const heightMap = heightTexture(heights, field.columns, field.rows);
    const gradients = gradientTexture(gradientHalves(field, heights), field.columns, field.rows);
    this.skyBake = new SkyBake(heightMap, gradients, { columns: field.columns, rows: field.rows, cell: field.cell, stride: ATTRIBUTE_STRIDE,
      coarse: { columns: coarse.columns, rows: coarse.rows } });
    this.maps = {
      heights: heightMap, gradients,
      attributes: attributeTexture(surfaceAttributes(coarse, coarse.heights), coarse.columns, coarse.rows),
      sunlight: sunTexture(this.sunBytes, field.columns, field.rows),
      noise: noiseTexture(),
      detail: detailTexture(),
      sky: this.skyBake.target.texture,
    };
    const material = new TerrainMaterial({ columns: field.columns, rows: field.rows, cell: field.cell, originX: field.originX, originZ: field.originZ,
      coarse: { columns: coarse.columns, rows: coarse.rows, cell: coarse.cell } }, this.maps, settings.spacing, surfaceStyle(map), settings.detailed);
    material.offset.set(offset[0], offset[1]);
    material.sunDirection.value.copy(this.sun);
    this.mesh = new THREE.Mesh(patchGeometry(), material);
    this.mesh.name = `${map.name} land`;
    this.mesh.position.set(offset[0], 0, offset[1]);
    // The patches are chosen per render, for its camera; the geometry has no bounds of its own to cull by.
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    // Ships' shadows and the clouds' reach the land through the sun's shadow node.
    this.mesh.receiveShadow = true;
    // Whichever of the land and its trees renders first bakes the open sky and chooses the patches for both.
    const prepare = (renderer: unknown, camera: THREE.Camera) => {
      this.skyBake.run(renderer as unknown as THREE.WebGPURenderer);
      this.select(renderer as unknown as THREE.WebGPURenderer, camera as THREE.PerspectiveCamera);
    };
    this.mesh.onBeforeRender = (renderer, _scene, camera) => prepare(renderer, camera);
    root.add(this.mesh);
    if (settings.trees) {
      this.treeAtlas = treeAtlasTexture();
      const trees = new TreeMaterial(material.grids, this.maps, this.treeAtlas, settings.spacing, surfaceStyle(map));
      trees.offset.copy(material.offset);
      trees.sunDirection.value.copy(this.sun);
      this.trees = new THREE.Mesh(treeGeometry(this.mesh.geometry.getAttribute('terrainPatch') as THREE.InstancedBufferAttribute), trees);
      this.trees.name = `${map.name} trees`;
      this.trees.position.copy(this.mesh.position);
      Object.assign(this.trees, { frustumCulled: false, castShadow: false, receiveShadow: true });
      this.trees.onBeforeRender = (renderer, _scene, camera) => prepare(renderer, camera);
      root.add(this.trees);
    }
  }

  /** Choose the patches for `camera` and upload them, unless they were chosen for this very view already. */
  private select(renderer: THREE.WebGPURenderer, camera: THREE.PerspectiveCamera): void {
    const target = renderer.getRenderTarget();
    const height = target ? target.height : renderer.getDrawingBufferSize(size).y;
    camera.updateMatrixWorld();
    const last = this.selected.camera, world = camera.matrixWorld.elements, lens = camera.projectionMatrix.elements;
    let same = this.selected.height === height;
    for (let k = 0; k < 16 && same; k++) same = last[k] === Math.fround(world[k]) && last[16 + k] === Math.fround(lens[k]);
    if (same) return;
    last.set(world); last.set(lens, 16); this.selected.height = height;
    projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projection, camera.coordinateSystem, camera.reversedDepth);
    const [ox, oz] = this.offset, position = camera.getWorldPosition(light);
    const view: LodView = {
      position: [position.x - ox, position.y, position.z - oz],
      // World planes moved into chart metres: n · (p + offset) + c = n · p + (c + n · offset).
      planes: frustum.planes.map(plane => [plane.normal.x, plane.normal.y, plane.normal.z, plane.constant + plane.normal.x * ox + plane.normal.z * oz] as const),
      fovY: THREE.MathUtils.degToRad(camera.fov) / (camera.zoom || 1),
      heightPx: Math.max(1, height),
      submerged: position.y < 0,
    };
    const geometry = this.mesh.geometry, patches = geometry.getAttribute('terrainPatch') as THREE.InstancedBufferAttribute;
    const count = this.lod.select(view, patches.array as Float32Array);
    geometry.instanceCount = count;
    patches.clearUpdateRanges();
    patches.addUpdateRange(0, count * PATCH_FLOATS);
    patches.needsUpdate = true;
    this.mesh.material.range.value = this.lod.ranges[0];
    // Trees dissolve before the end of level 0, and before the nearest land left without them.
    if (this.trees) { this.trees.geometry.instanceCount = this.lod.nearLand; this.trees.material.range.value = Math.min(this.lod.ranges[0], this.lod.treeReach / .85); }
  }

  update(_camera: THREE.PerspectiveCamera): void {
    if (this.disposed) return;
    const sun = this.findSun();
    if (!sun) return;
    light.subVectors(sun.position, sun.target.position);
    if (light.lengthSq() < 1e-12) return;
    light.normalize();
    this.mesh.material.sunDirection.value.copy(light);
    this.trees?.material.sunDirection.value.copy(light);
    if (light.angleTo(this.sun) < SUN_TOLERANCE) return;
    this.sun.copy(light);
    sunVisibility(this.field, this.heights, this.sun.toArray(), undefined, this.sunBytes);
    this.maps.sunlight.needsUpdate = true;
  }

  /** The scene's directional sun: the light the scene's lit meshes share (the game names it "Sun"). */
  private findSun(): THREE.DirectionalLight | undefined {
    if (this.sunLight?.parent) return this.sunLight;
    let scene: THREE.Object3D = this.root;
    while (scene.parent) scene = scene.parent;
    const lights = scene.children.filter((child): child is THREE.DirectionalLight => (child as THREE.DirectionalLight).isDirectionalLight === true);
    return this.sunLight = lights.find(child => child.name === 'Sun') ?? lights[0];
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.trees?.geometry.dispose();
    this.trees?.material.dispose();
    this.treeAtlas?.dispose();
    for (const [name, texture] of Object.entries(this.maps)) if (name !== 'sky') texture.dispose();
    this.skyBake.dispose();
  }
}
