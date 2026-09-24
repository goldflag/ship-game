/** Textured renders of a cached GameModels3D reference, so windows, doors and markings the source paints into its
 * textures are visible when comparing: silhouette comparisons (`ship:overlay`, workbench views) cannot show them.
 * Viewing only — the geometry and textures stay in ignored `.build/` and are never committed or imported.
 *
 * Frames and cameras follow `ship:slice`, `ship:overlay` and `ui:shot`: ship metres, +X starboard, +Y up with
 * y = 0 the waterline, −Z bow, and `scripts/browser/cameraPoses.ts` for `--camera`/`--eye`/`--target`/`--fov`. */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { applyPoint, referenceDirectory, toShipFrame, visualGroup, walkScheme, METRES_PER_UNIT, type ReferenceMeta, type Vec3 } from './reference';
import type { ReferencePack } from '../../tools/ship-overlay/reference';
import { cameraPin, type CameraPose } from '../browser/cameraPoses';

export const NAMED_SHOTS = ['side', 'top', 'front', 'stern'] as const;
export type NamedShot = (typeof NAMED_SHOTS)[number];
export interface RenderShot {
  name: string;
  eye: Vec3;
  target: Vec3;
  /** Camera up in ship axes; +Y unless looking straight down. */
  up: Vec3;
  /** Perspective vertical field of view in degrees, or an orthographic width in metres. */
  fov?: number;
  ortho?: number;
  size: [number, number];
}
export interface RenderOptions {
  shots?: string[];
  camera?: CameraPose;
  fov?: number;
  ortho?: number;
  paint?: string;
  /** Added to every reference point, to line it up with a ship the way `ship:overlay --offset` does. */
  offset?: Vec3;
  parts?: string[];
  size?: [number, number];
  out?: string;
}
interface Bucket {
  texture?: string;
  color: [number, number, number];
  positions: number[];
  uv: number[];
  index: number[];
}

const colorOf = (value: number | undefined): [number, number, number] =>
  value === undefined ? [0.6, 0.62, 0.64] : [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];

/** Orthographic named views about the reference bounds: side and top with the bow on the right, front looking aft
 * from ahead, stern looking forward from astern — the same framing `ship:overlay` uses. */
export function namedShot(name: NamedShot, bounds: ReferenceMeta['bounds'], offset: Vec3 = [0, 0, 0]): RenderShot {
  const min = bounds.min.map((v, i) => v + offset[i]) as Vec3;
  const max = bounds.max.map((v, i) => v + offset[i]) as Vec3;
  const centre = min.map((v, i) => (v + max[i]) / 2) as Vec3;
  const length = max[2] - min[2], beam = max[0] - min[0], height = max[1] - min[1];
  const far = Math.max(length, beam, height) * 2;
  const width = 2400;
  const wide = (across: number, tall: number): [number, number] => [width, Math.max(200, Math.round((width * tall) / across / 2) * 2)];
  if (name === 'side') return { name, eye: [centre[0] + far, centre[1], centre[2]], target: centre, up: [0, 1, 0], ortho: length * 1.04, size: wide(length * 1.04, height * 1.08) };
  if (name === 'top') return { name, eye: [centre[0], centre[1] + far, centre[2]], target: centre, up: [-1, 0, 0], ortho: length * 1.04, size: wide(length * 1.04, beam * 1.1) };
  const across = Math.max(beam, height) * 1.1;
  const square: [number, number] = [1400, 1400];
  if (name === 'front') return { name, eye: [centre[0], centre[1], min[2] - far], target: centre, up: [0, 1, 0], ortho: across, size: square };
  return { name, eye: [centre[0], centre[1], max[2] + far], target: centre, up: [0, 1, 0], ortho: across, size: square };
}

/** The shots a command asked for: named views, plus one `--camera`/`--eye` shot; `side` and `front` by default. */
export function renderShots(meta: ReferenceMeta, options: RenderOptions): RenderShot[] {
  const offset = options.offset ?? [0, 0, 0];
  const shots: RenderShot[] = [];
  const named = options.shots ?? (options.camera ? [] : ['side', 'front']);
  for (const name of named) {
    if (!(NAMED_SHOTS as readonly string[]).includes(name)) throw new Error(`Unknown shot "${name}". Named shots: ${NAMED_SHOTS.join(', ')}; use --camera or --eye/--target for any other view.`);
    shots.push(namedShot(name as NamedShot, meta.bounds, offset));
  }
  if (options.camera) {
    const length = meta.bounds.max[2] - meta.bounds.min[2];
    const pin = cameraPin(options.camera, length);
    shots.push({ name: 'camera', eye: pin.eye, target: pin.target, up: [0, 1, 0], ...(options.ortho ? { ortho: options.ortho } : { fov: options.fov ?? pin.fov ?? 35 }), size: options.size ?? [1600, 1000] });
  }
  return shots;
}

/** Every visual instance of the configuration, with its UVs and the texture its paint names, in ship metres. */
export function texturedParts(pack: ReferencePack, root: import('../../tools/ship-overlay/reference').ReferenceNode, options: { paint?: string; parts?: string[]; offset?: Vec3; metresPerUnit?: number },
  helpers: { paintMaterials: typeof import('../../tools/ship-overlay/reference').paintMaterials; geometryGroups: typeof import('../../tools/ship-overlay/reference').geometryGroups }): Bucket[] {
  const paint = options.paint ?? 'default';
  if (!(paint in pack.paints)) throw new Error(`Unknown paint "${paint}". This vehicle offers: ${Object.keys(pack.paints).join(', ')}.`);
  const offset = options.offset ?? [0, 0, 0];
  const wanted = options.parts?.length ? new Set(options.parts) : undefined;
  const buckets = new Map<string, Bucket>();
  for (const { node, matrix } of walkScheme(root)) {
    const visual = node.visual;
    if (typeof visual !== 'string' || !pack.models[visual]) continue;
    if (wanted && !wanted.has(visualGroup(visual))) continue;
    const model = pack.models[visual];
    for (const [key, geometry] of Object.entries(model.geometry)) {
      const materials = helpers.paintMaterials(model, key, paint) ?? [];
      const groups = helpers.geometryGroups(geometry);
      const ranges = groups.length ? groups : [{ start: 0, count: geometry.index.length, material: 0 }];
      const count = geometry.position.length / 3;
      const world: Vec3[] = [];
      for (let i = 0; i < count; i++) {
        const p = toShipFrame(applyPoint(matrix, [geometry.position[i * 3], geometry.position[i * 3 + 1], geometry.position[i * 3 + 2]]), options.metresPerUnit ?? METRES_PER_UNIT);
        world.push([p[0] + offset[0], p[1] + offset[1], p[2] + offset[2]]);
      }
      for (const range of ranges) {
        const material = materials[range.material] ?? {};
        const bucketKey = material.map ?? 'color:' + (material.color ?? 'none');
        let bucket = buckets.get(bucketKey);
        if (!bucket) buckets.set(bucketKey, (bucket = { ...(material.map ? { texture: material.map } : {}), color: colorOf(material.color), positions: [], uv: [], index: [] }));
        const remap = new Map<number, number>();
        const vertex = (i: number) => {
          let at = remap.get(i);
          if (at === undefined) {
            at = bucket.positions.length / 3;
            remap.set(i, at);
            bucket.positions.push(...world[i]);
            bucket.uv.push(geometry.uv?.[i * 2] ?? 0, geometry.uv?.[i * 2 + 1] ?? 0);
          }
          return at;
        };
        // The reflection to ship axes mirrors the mesh, so the winding flips to keep faces outward.
        for (let t = range.start; t + 2 < range.start + range.count; t += 3)
          bucket.index.push(vertex(geometry.index[t]), vertex(geometry.index[t + 2]), vertex(geometry.index[t + 1]));
      }
    }
  }
  return [...buckets.values()].filter((bucket) => bucket.index.length);
}

/** Fetch what is missing, lay out the scene for Blender and render every shot. Returns the written images. */
export async function renderReference(rootDir: string, meta: ReferenceMeta, options: RenderOptions = {}): Promise<{ directory: string; paint: string; shots: { name: string; file: string }[]; textures: number; triangles: number }> {
  if (meta.kind !== 'gamemodels3d' || !meta.vehicle || !meta.hull) throw new Error('A textured render needs a GameModels3D reference; a local GLB or OBJ has no source textures.');
  const { loadReference, loadTexture, packDataRoot } = await import('../../tools/ship-overlay/download');
  const { assembleReference, paintMaterials, geometryGroups } = await import('../../tools/ship-overlay/reference');
  const { runBlender } = await import('../build/blender');
  const pack = await loadReference(rootDir, meta.vehicle);
  const shots = renderShots(meta, options);
  if (!shots.length) throw new Error('No shots: pass --shots side,top,front,stern and/or --camera, --eye/--target.');
  const buckets = texturedParts(pack, assembleReference(pack.scheme, meta.hull, meta.components ?? []), { paint: options.paint, parts: options.parts, offset: options.offset, metresPerUnit: meta.frame.metresPerUnit }, { paintMaterials, geometryGroups });
  if (!buckets.length) throw new Error('Nothing to render: no reference part matched ' + (options.parts?.join(', ') ?? 'the configuration') + '.');
  const directory = resolve(options.out ?? join(referenceDirectory(rootDir, meta.name), 'renders'));
  const scratch = join(directory, '.scene');
  await mkdir(scratch, { recursive: true });
  const { createHash } = await import('node:crypto');
  const { extname } = await import('node:path');
  const dataRoot = packDataRoot(pack);
  const layout = [];
  const blobs: Buffer[] = [];
  let at = 0;
  for (const bucket of buckets) {
    let texture: string | undefined;
    if (bucket.texture) {
      const data = await loadTexture(rootDir, bucket.texture, dataRoot).catch(() => undefined);
      if (data) {
        texture = join(rootDir, '.build/ship-overlay/textures', createHash('sha256').update(bucket.texture).digest('hex') + extname(bucket.texture));
      }
    }
    const positions = Buffer.from(new Float32Array(bucket.positions).buffer);
    const uv = Buffer.from(new Float32Array(bucket.uv).buffer);
    const index = Buffer.from(new Uint32Array(bucket.index).buffer);
    layout.push({ texture: texture ?? null, color: bucket.color, vertices: bucket.positions.length / 3, triangles: bucket.index.length / 3, positions: at, uv: at + positions.length, index: at + positions.length + uv.length });
    blobs.push(positions, uv, index);
    at += positions.length + uv.length + index.length;
  }
  await writeFile(join(scratch, 'scene.bin'), Buffer.concat(blobs));
  const manifest = { scene: join(scratch, 'scene.bin'), buckets: layout, shots, directory };
  await writeFile(join(scratch, 'scene.json'), JSON.stringify(manifest));
  await runBlender(join(import.meta.dir, 'blender/reference_render.py'), {}, { args: [join(scratch, 'scene.json')], log: join(scratch, 'blender.log') });
  return {
    directory, paint: options.paint ?? 'default', textures: layout.filter((bucket) => bucket.texture).length, triangles: layout.reduce((sum, bucket) => sum + bucket.triangles, 0),
    shots: shots.map((shot) => ({ name: shot.name, file: join(directory, shot.name + '.png') })),
  };
}
