/** Trees standing on the land near the camera, placed and sized on the GPU by the same land-use masks that paint the
 * ground, so the forest drawn as trees is the forest painted beneath them.
 *
 * Every level-0 patch of the terrain's level of detail carries a grid of `TREE_SLOTS`² tree slots, one per level-0
 * vertex spacing, drawn as one instance of a mesh of that many cards sharing the terrain's patch buffer: the first
 * instances of the buffer are the level-0 patches with land on them, and the trees draw only those. Each slot holds at
 * most one tree, jittered within it by a hash of its cell on the chart, so a tree keeps its place wherever the
 * patches fall; its kind, height and tint come from `treeCover` at its foot. Cards face the camera, stand on the exact
 * ground height, and are lit as rounded crowns by the scene's sun (shaded by the land's own shadow at their foot) and
 * sky (shaded by the open sky there). Beyond about 60–85% of level 0's range they dissolve through alpha to coverage,
 * where the painted canopy takes over. Binoculars pull level 0 out to the land they look at, so the trees follow. */
import * as THREE from 'three/webgpu';
import {
  attribute, cameraPosition, cameraViewMatrix, cross, dot, float, fract, max, mix, normalize, positionGeometry, select, sin, smoothstep, texture,
  uniform, varying, vec2, vec3, vec4,
} from 'three/tsl';
import { TerrainLightingModel, terrainHeight, turned, type TerrainGrids, type TerrainMaps } from './TerrainMaterial';
import { treeCover, type SurfaceStyle } from './TerrainSurface';
import { TREE_KINDS, TREE_SHAPES, TREE_VARIANTS } from './TreeAtlas';

type Node<T extends string = string> = THREE.Node<T>;
type Float = Node<'float'>;
type Vec2 = Node<'vec2'>;

/** Tree slots along a patch's side: one per level-0 vertex spacing. */
export const TREE_SLOTS = 16;

/** One patch's cards: `TREE_SLOTS`² quads, each with its slot (i, j); the corner is the position (x across −0.5–0.5,
 * y up 0–1). Instanced by the terrain's own patch attribute. */
export function treeGeometry(patches: THREE.InstancedBufferAttribute): THREE.InstancedBufferGeometry {
  const n = TREE_SLOTS, count = n * n;
  const positions = new Float32Array(count * 4 * 3), slots = new Float32Array(count * 4 * 2), indices: number[] = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const tree = j * n + i;
    [[-.5, 0], [.5, 0], [-.5, 1], [.5, 1]].forEach(([x, y], k) => {
      positions.set([x, y, 0], (tree * 4 + k) * 3);
      slots.set([i, j], (tree * 4 + k) * 2);
    });
    const a = tree * 4;
    indices.push(a, a + 1, a + 3, a, a + 3, a + 2);
  }
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('treeSlot', new THREE.BufferAttribute(slots, 2));
  geometry.setAttribute('terrainPatch', patches);
  geometry.setIndex(indices);
  geometry.instanceCount = 0;
  return geometry;
}

/** A float hash of a cell index in 0–1: stable per cell, uncorrelated between `salt`s. */
const hash = (cell: Vec2, salt: number): Float => fract(sin(dot(cell.add(salt * 17.13), vec2(12.9898, 78.233))).mul(43758.5453));

export class TreeMaterial extends THREE.MeshStandardNodeMaterial {
  /** Range of level 0 in metres, as the terrain's: the trees dissolve toward its end. */
  readonly range = uniform(10000);
  readonly sunDirection = uniform(new THREE.Vector3(0, 1, 0));
  /** World offset of the chart (x, z). */
  readonly offset = new THREE.Vector2();
  private readonly sunlightNode: Float;

  constructor(grids: TerrainGrids, maps: TerrainMaps, atlas: THREE.Texture, spacing: number, style: SurfaceStyle) {
    super({ roughness: .9, metalness: 0 });
    this.name = 'Battle terrain trees';
    this.alphaToCoverage = true;
    this.alphaTest = .02;
    const { columns, rows, cell, originX, originZ, coarse } = grids;
    const origin = vec2(originX, originZ);
    const heightAt = terrainHeight(maps.heights, grids);
    const offset = uniform(this.offset);

    const patch = attribute<'vec4'>('terrainPatch', 'vec4'), slot = attribute<'vec2'>('treeSlot', 'vec2');
    const corner = positionGeometry.xy;
    // The slot's cell on the chart: stable wherever the patches fall.
    const cellIndex = patch.xy.sub(origin).div(spacing).add(slot).floor();
    const jitter = vec2(hash(cellIndex, 1), hash(cellIndex, 2)).mul(.8).add(.1);
    const foot = patch.xy.add(slot.add(jitter).mul(spacing));
    const ground = heightAt(foot);
    const fieldUv = foot.sub(origin).div(cell).add(.5).div(vec2(columns, rows));
    const coarseUv = foot.sub(origin).div(coarse.cell).add(.5).div(vec2(coarse.columns, coarse.rows));
    const gradient = texture(maps.gradients, fieldUv).level(float(0)).xy;
    const attributes = texture(maps.attributes, coarseUv).level(float(0));
    const cover = treeCover(style, {
      chart: foot, height: ground, gradient, normal: normalize(vec3(gradient.x.negate(), 1, gradient.y.negate())), footprint: float(0), time: float(0),
      sun: this.sunDirection, sky: texture(maps.sky, coarseUv).level(float(0)).r, drainage: attributes.r, broad: attributes.g, coast: attributes.b, fine: attributes.a,
      noise: (metres: number) => texture(maps.noise, turned(foot, metres).div(metres)).level(float(0)),
      noiseAt: (uv: Vec2) => texture(maps.noise, uv).level(float(0)),
      detail: (metres: number) => texture(maps.detail, turned(foot, metres * 1.7).div(metres)).level(float(0)),
    }, hash(cellIndex, 3));
    const standing = hash(cellIndex, 4).lessThan(cover.density);
    const treeHeight = select(standing, cover.height.mul(hash(cellIndex, 5).mul(.5).add(.75)), float(0));
    const kind = cover.kind;
    const aspect = select(kind.lessThan(.5), float(TREE_SHAPES.broadleaf.aspect), select(kind.lessThan(1.5), float(TREE_SHAPES.palm.aspect),
      select(kind.lessThan(2.5), float(TREE_SHAPES.conifer.aspect), float(TREE_SHAPES.bare.aspect))));
    const width = treeHeight.mul(aspect).mul(hash(cellIndex, 6).mul(.3).add(.85));

    // Face the camera, standing on the ground (sunk on slopes, so the downhill side does not float).
    const camera = cameraPosition.sub(vec3(offset.x, 0, offset.y));
    const base = vec3(foot.x, ground.sub(gradient.length().mul(width).mul(.35)).sub(.5), foot.y);
    const toCamera = camera.sub(base), reach = toCamera.length(), view = toCamera.div(reach.max(1e-3));
    const right = normalize(cross(vec3(0, 1, 0), view).add(vec3(1e-5, 0, 0)));
    const up = normalize(mix(vec3(0, 1, 0), cross(view, right), .5));
    this.positionNode = base.add(right.mul(corner.x.mul(width))).add(up.mul(corner.y.mul(treeHeight)));

    // Dissolve before the painted canopy takes over, at the end of level 0.
    const fade = varying(float(1).sub(smoothstep(this.range.mul(.6), this.range.mul(.85), reach)), 'vTreeFade');
    const variant = select(hash(cellIndex, 7).lessThan(.5), float(0), float(1));
    const uv = varying(vec2(kind.add(corner.x).add(.5).div(TREE_KINDS.length), variant.add(corner.y).div(TREE_VARIANTS)), 'vTreeUv');
    const tint = varying(cover.tint.mul(hash(cellIndex, 8).mul(.3).add(.85)), 'vTreeTint');
    this.sunlightNode = varying(texture(maps.sunlight, fieldUv).level(float(0)).r, 'vTreeSun');
    const openSky = varying(texture(maps.sky, coarseUv).level(float(0)).r, 'vTreeSky');
    // The card's own frame, for a rounded crown's normal: across, up and toward the camera.
    const crown = varying(vec3(corner.x.mul(2), corner.y.sub(.6).mul(1.6), 0), 'vTreeCrown');
    const frameRight = varying(right, 'vTreeRight'), frameUp = varying(up, 'vTreeUp'), frameView = varying(view, 'vTreeView');

    const texel = texture(atlas, uv);
    // Alpha to coverage over a sharpened edge: the crown keeps its coverage in every mip level.
    const alpha = texel.a.sub(.45).div(max(texel.a.fwidth(), 1e-4)).add(.5).clamp(0, 1).mul(fade);
    this.colorNode = texel.rgb.mul(tint);
    this.opacityNode = alpha;
    const normal = normalize(frameRight.mul(crown.x).add(frameUp.mul(crown.y)).add(frameView.mul(1.1)));
    this.normalNode = cameraViewMatrix.mul(vec4(normal, 0)).xyz.normalize();
    // Darker low in the crown and toward the ground, and where the land around hides the sky.
    this.aoNode = openSky.mul(openSky).mul(corner.y.mul(.45).add(.55));
  }

  override setupLightingModel(): THREE.PhysicalLightingModel {
    return new TerrainLightingModel(this.sunlightNode, float(.2));
  }
}
