/** The terrain's node material: displaces the level-of-detail patches onto the heightfield and shades the land.
 *
 * Vertex stage. A patch instance carries its corner in chart metres and its level; its vertex (i, j) sits at
 * corner + (i, j) · spacing · 2^level. Odd vertices slide toward their even neighbours across the outer part of
 * the level's range (`TerrainLod`), and the height is then read from the field texel by texel and interpolated
 * with the same bilinear expression as `Heightfield.height`, so every level-0 vertex stands exactly on the land
 * the simulation grounds ships on and strikes shells against.
 *
 * Fragment stage. The smooth normal comes from the gradient texture; the land's cover (`TerrainSurface`) from the
 * height, slope, relief, open sky and distance to the coast, shaped by procedural noise and detail photographs.
 * The sun is further shaded by the land itself (`sunVisibility`, applied to the directional light only through
 * `TerrainLightingModel`); the sky's light by the open sky. Ships' shadows and the clouds' reach the land through
 * the sun's own shadow node, as they reach ships. Scene fog does the aerial perspective, as for everything else. */
import * as THREE from 'three/webgpu';
import {
  BRDF_GGX, BRDF_Lambert, Fn, attribute, cameraPosition, cameraViewMatrix, clamp, cross, dFdx, dFdy, diffuseColor, dot, exp2, float, floor, fract, int,
  ivec2, max, normalView, normalize, positionGeometry, positionLocal, positionWorld, roughness, select, sign, smoothstep, specularColor, specularF90,
  texture, textureLoad, uniform, varying, vec2, vec3, vec4,
} from 'three/tsl';
import { MORPH_END, MORPH_START } from './TerrainLod';
import { OPEN_SEA_M } from '../../maps/heightfield';
import { terrainSurface, type SurfaceStyle } from './TerrainSurface';

type Node<T extends string = string> = THREE.Node<T>;
type Float = Node<'float'>;
type Vec2 = Node<'vec2'>;
type Vec3 = Node<'vec3'>;

/** The grids the textures cover: the field's own and the coarser attribute grid, both from the field's origin. */
export interface TerrainGrids {
  readonly columns: number; readonly rows: number; readonly cell: number; readonly originX: number; readonly originZ: number;
  readonly coarse: { readonly columns: number; readonly rows: number; readonly cell: number };
}

export interface TerrainMaps {
  readonly heights: THREE.DataTexture;
  readonly gradients: THREE.DataTexture;
  readonly attributes: THREE.DataTexture;
  readonly sunlight: THREE.DataTexture;
  readonly noise: THREE.DataTexture;
  readonly detail: THREE.DataTexture;
  /** Open sky (`SkyBake`), on the coarse grid. */
  readonly sky: THREE.Texture;
}

/** Bilinear height at chart metres from the height texture, `OPEN_SEA_M` off the field: `Heightfield.height`, operand
 * for operand. A WGSL function of its own, for vertex stages. */
export function terrainHeight(heights: THREE.Texture, grids: Pick<TerrainGrids, 'columns' | 'rows' | 'cell' | 'originX' | 'originZ'>): (xz: Vec2) => Float {
  const { columns, rows, cell, originX, originZ } = grids;
  const origin = vec2(originX, originZ);
  return Fn(([xz]: [Vec2]) => {
    const g = xz.sub(origin).div(cell);
    const i = clamp(floor(g.x), 0, columns - 2), j = clamp(floor(g.y), 0, rows - 2);
    const u = g.x.sub(i), v = g.y.sub(j), x = int(i), z = int(j);
    const h00 = textureLoad(heights, ivec2(x, z)).r, h10 = textureLoad(heights, ivec2(x.add(1), z)).r;
    const h01 = textureLoad(heights, ivec2(x, z.add(1))).r, h11 = textureLoad(heights, ivec2(x.add(1), z.add(1))).r;
    const top = h00.mul(float(1).sub(u)).add(h10.mul(u)), bottom = h01.mul(float(1).sub(u)).add(h11.mul(u));
    const inside = g.x.greaterThanEqual(0).and(g.y.greaterThanEqual(0)).and(g.x.lessThanEqual(columns - 1)).and(g.y.lessThanEqual(rows - 1));
    return select(inside, top.mul(float(1).sub(v)).add(bottom.mul(v)), float(OPEN_SEA_M));
  }).setLayout({ name: 'terrainHeight', type: 'float', inputs: [{ name: 'xz', type: 'vec2' }] }) as unknown as (xz: Vec2) => Float;
}

/** The physical model with two changes for land. The scene's sun (and moon) is shaded by the land's own shadow
 * (`sunlight`); other lights pass as they are. And the Fresnel of both the direct and the sky's specular light goes
 * to `specular` at grazing angles instead of 1: a canopy, grass or snow is no smooth dielectric, and with a mirror's
 * grazing reflection every distant slope turned sky-coloured. */
export class TerrainLightingModel extends THREE.PhysicalLightingModel {
  constructor(private readonly sunlight: Float, private readonly specular: Float) { super(); }
  override direct(data: Parameters<THREE.PhysicalLightingModel['direct']>[0]): void {
    const { lightDirection, reflectedLight } = data as unknown as { lightDirection: Vec3; reflectedLight: { directDiffuse: Vec3; directSpecular: Vec3 } };
    const light = (data.lightNode as unknown as { light?: THREE.DirectionalLight }).light;
    const color = light?.isDirectionalLight ? (data.lightColor as Vec3).mul(this.sunlight) : data.lightColor as Vec3;
    const irradiance = normalView.dot(lightDirection).clamp().mul(color);
    const lambert = BRDF_Lambert({ diffuseColor: diffuseColor.rgb }) as unknown as Vec3;
    const ggx = BRDF_GGX({ lightDirection, f0: vec3(.04).mul(this.specular), f90: this.specular, roughness }) as unknown as Vec3;
    reflectedLight.directDiffuse.addAssign(irradiance.mul(lambert));
    reflectedLight.directSpecular.addAssign(irradiance.mul(ggx));
  }
}

/** What the terrain can draw instead of the lit land, for review: its albedo, normal, the sun's visibility, open sky, the
 * sky occlusion it applies, the level of detail of each patch, the coast (distance in red, the coastline in green), the
 * broad and fine relief, and the slope. */
export const TERRAIN_DEBUG = ['off', 'albedo', 'normal', 'sun', 'sky', 'occlusion', 'lod', 'coast', 'relief', 'slope'] as const;
export type TerrainDebug = typeof TERRAIN_DEBUG[number];

export class TerrainMaterial extends THREE.MeshStandardNodeMaterial {
  /** Range of level 0 in metres, from the last selection: the morph bands scale with it. */
  readonly range = uniform(10000);
  /** Seconds, for the moving swash at the waterline. */
  readonly time = uniform(0);
  /** Unit direction toward the sun (or the moon), world axes. */
  readonly sunDirection = uniform(new THREE.Vector3(0, 1, 0));
  private readonly sunlightNode: Float;
  private readonly specularNode: Float;

  constructor(readonly grids: TerrainGrids, readonly maps: TerrainMaps, spacing: number, style: SurfaceStyle, detailed = true) {
    super({ roughness: .95, metalness: 0 });
    this.name = 'Battle terrain';
    const { columns, rows, cell, originX, originZ } = grids;
    const origin = vec2(originX, originZ);

    // Vertex stage.
    const heightAt = terrainHeight(maps.heights, grids);
    const patch = attribute<'vec4'>('terrainPatch', 'vec4');
    const grid = positionGeometry.xz, level = patch.z;
    const step = float(spacing).mul(exp2(level));
    const corner = patch.xy.add(grid.mul(step));
    // The camera in chart metres: the mesh stands at the chart's offset in the world.
    const offset = uniform(this.offset);
    const camera = cameraPosition.sub(vec3(offset.x, 0, offset.y));
    const reach = vec3(corner.x, heightAt(corner), corner.y).sub(camera).length();
    const range = this.range.mul(exp2(level));
    const morph = clamp(reach.sub(range.mul(MORPH_START)).div(range.mul(MORPH_END - MORPH_START)), 0, 1);
    const xz = corner.sub(fract(grid.mul(.5)).mul(2).mul(step).mul(morph));
    this.positionNode = vec3(xz.x, heightAt(xz), xz.y);

    // Fragment stage.
    const chart = positionLocal.xz, height = positionLocal.y;
    const fieldUv = chart.sub(origin).div(cell).add(.5).div(vec2(columns, rows));
    const coarse = grids.coarse;
    const coarseUv = chart.sub(origin).div(coarse.cell).add(.5).div(vec2(coarse.columns, coarse.rows));
    const gradient = texture(maps.gradients, fieldUv).xy;
    const attributes = texture(maps.attributes, coarseUv);
    const openSky = texture(maps.sky, coarseUv).r;
    this.sunlightNode = texture(maps.sunlight, fieldUv).r;
    const macroNormal = normalize(vec3(gradient.x.negate(), 1, gradient.y.negate()));
    // Metres a pixel spans on the land: procedural detail fades to its mean before it would alias.
    const footprint = max(dFdx(positionWorld).length(), dFdy(positionWorld).length()).max(.01);

    const surface = terrainSurface(style, {
      chart, height, gradient, normal: macroNormal, footprint, detailed, time: this.time, sun: this.sunDirection,
      sky: openSky, drainage: attributes.r, broad: attributes.g, coast: attributes.b, fine: attributes.a,
      noise: (metres: number) => texture(maps.noise, turned(chart, metres).div(metres)),
      noiseAt: (uv: Vec2) => texture(maps.noise, uv),
      detail: (metres: number) => texture(maps.detail, turned(chart, metres * 1.7).div(metres)),
    });
    this.roughnessNode = surface.roughness;
    this.specularNode = surface.specular;
    this.aoNode = surface.occlusion;
    // The small relief of crowns, rocks and furrows only where the setting affords it.
    const normal = surface.bump && detailed ? bumped(macroNormal, surface.bump) : macroNormal;
    this.normalNode = cameraViewMatrix.mul(vec4(normal, 0)).xyz.normalize();

    // Debug views replace the lit albedo with one input, unlit (`TERRAIN_DEBUG`).
    const levelColor = varying(vec3(fract(level.mul(.37)), fract(level.mul(.61).add(.3)), fract(level.mul(.83).add(.6))), 'vTerrainLevel');
    const views: Record<Exclude<TerrainDebug, 'off'>, Vec3> = {
      albedo: surface.albedo, normal: normal.mul(.5).add(.5), sun: vec3(this.sunlightNode), sky: vec3(openSky),
      occlusion: vec3(surface.occlusion), lod: levelColor, coast: vec3(attributes.b, smoothstep(.49, .51, attributes.b), 0),
      relief: vec3(attributes.g, attributes.a, .5), slope: vec3(gradient.length().div(1.5)),
    };
    let debugColor: Vec3 = vec3(0);
    TERRAIN_DEBUG.forEach((mode, index) => { if (mode !== 'off') debugColor = select(this.debug.equal(index), views[mode], debugColor); });
    this.colorNode = select(this.debug.equal(0), surface.albedo, vec3(0));
    // Scaled into the display transform's middle range, so values read as greys rather than all white.
    this.emissiveNode = debugColor.mul(debugColor).mul(.45);
  }

  /** Index into `TERRAIN_DEBUG` of the view drawn; 0 draws the land. */
  readonly debug = uniform(0, 'int');

  /** World offset of the chart (x, z): the mesh's position, mirrored for the vertex shader's camera. */
  readonly offset = new THREE.Vector2();

  override setupLightingModel(): THREE.PhysicalLightingModel {
    return new TerrainLightingModel(this.sunlightNode, this.specularNode);
  }

  override setupSpecular(): void {
    super.setupSpecular();
    specularColor.assign(vec3(.04).mul(this.specularNode));
    specularF90.assign(this.specularNode);
  }
}

/** `chart` turned and shifted by an angle and offset of its own for each scale, so tiles of different scales never
 * line up and no repeat of the tile draws a grid across the land. */
export function turned(chart: Vec2, metres: number): Vec2 {
  const angle = (metres * 2.399963) % (2 * Math.PI), c = Math.cos(angle), s = Math.sin(angle);
  const shift = (metres * 7.31) % 1000;
  return vec2(chart.x.mul(c).sub(chart.y.mul(s)).add(shift), chart.x.mul(s).add(chart.y.mul(c)).add(shift * .61));
}

/** `normal` tilted by the screen-space gradient of `bump` (metres of height), after Mikkelsen's surface gradient:
 * the relief of crowns, rocks and furrows too small for the field. */
function bumped(normal: Vec3, bump: Float): Vec3 {
  const dx = dFdx(positionWorld), dy = dFdy(positionWorld);
  const r1 = cross(dy, normal), r2 = cross(normal, dx);
  const det = dot(dx, r1);
  const surfaceGradient = r1.mul(dFdx(bump)).add(r2.mul(dFdy(bump))).mul(sign(det));
  return normalize(normal.mul(det.abs()).sub(surfaceGradient));
}
