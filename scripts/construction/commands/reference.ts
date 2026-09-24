import type { CliCommand } from '../command';

/** Fetch or reuse a reference vehicle and cache it as a ship-frame triangle mesh for slice, loft, hardpoints and compare. */
export default {
  summary:
    '<vehicle-id|vehicle-url|file.glb|file.obj> [--name cache-name] [--hull A_Hull] [--components A_Artillery,…] [--hull-only] [--refresh] ' +
    '[--scale 15] [--flip-z] [--list] [--render [--shots side,top,front,stern] [--camera preset|az,el[,m]] [--eye x,y,z --target x,y,z] ' +
    '[--fov deg] [--ortho m] [--paint id] [--offset z|x,y,z] [--parts hull,misc,…] [--out dir]] — cache a GameModels3D vehicle (network) or a ' +
    'local GLB/OBJ as a ship-frame mesh in .build/references/<name>/ (+X starboard, +Y up with y=0 the waterline, −Z bow, metres); --list prints ' +
    'what is already cached; --render draws it with its source textures into .build/references/<name>/renders/',
  ship: false,
  positionals: 1,
  values: ['--name', '--hull', '--components', '--scale', '--shots', '--camera', '--eye', '--target', '--fov', '--ortho', '--paint', '--offset', '--parts', '--out'],
  switches: ['--hull-only', '--refresh', '--flip-z', '--list', '--render'],
  async run(ctx) {
    const { basename, extname, resolve } = await import('node:path');
    const { readFile } = await import('node:fs/promises');
    const reference = await import('../reference');
    const { listReferences, readReferenceMeta, referenceName, packReference, assembleParts, writeReference, METRES_PER_UNIT } = reference;
    const source = ctx.positionals[0];
    if (ctx.has('--list')) {
      if (source) throw new Error('--list takes no vehicle or file.');
      const cached = await listReferences(ctx.root);
      return {
        directory: reference.REFERENCE_ROOT,
        references: cached.map((meta) => ({
          name: meta.name, kind: meta.kind, source: meta.source, vehicleName: meta.vehicleName, fetchedAt: meta.fetchedAt,
          triangles: meta.triangles, hullTriangles: meta.hullTriangles, groups: meta.groups, hardpoints: meta.hardpoints.length, bounds: meta.bounds,
        })),
      };
    }
    if (!source) throw new Error('Provide a GameModels3D vehicle ID or URL, or a local .glb/.obj path. Use --list for the cache.');
    const local = /[/\\.]/.test(source) && !/^https?:/i.test(source);
    const scale = ctx.option('--scale') === undefined ? undefined : Number(ctx.option('--scale'));
    if (scale !== undefined && (!Number.isFinite(scale) || scale <= 0 || scale > 1000)) throw new Error('--scale must be a positive number of metres per source unit.');
    let name = ctx.option('--name');
    if (local) {
      if (ctx.has('--render')) throw new Error('--render needs a GameModels3D reference; a local GLB or OBJ has no source textures.');
      const path = resolve(source);
      const extension = extname(path).toLowerCase();
      if (extension !== '.glb' && extension !== '.obj') throw new Error('Local references must be .glb or .obj.');
      name = referenceName(name ?? basename(path, extension).replace(/[^a-z0-9_-]/gi, '-'));
      if (!ctx.has('--refresh') && (await readReferenceMeta(ctx.root, name).catch(() => undefined))) throw new Error(`Reference "${name}" is already cached. Add --refresh to rebuild it.`);
      const { parseGlb, parseObj } = await import('../referenceFile');
      const options = { scale: scale ?? 1, flipZ: ctx.has('--flip-z') };
      const data = await readFile(path);
      const parts = extension === '.glb' ? parseGlb(data, options) : parseObj(data.toString('utf8'), options);
      const mesh = packReference(
        { parts, hardpoints: [], omitted: [] },
        {
          name, kind: 'file', source: path, fetchedAt: new Date().toISOString(),
          frame: { metresPerUnit: options.scale, reflectedZ: options.flipZ, waterlineY: 0, axes: '+X starboard, +Y up (y=0 waterline), −Z bow, metres' },
        },
      );
      const directory = await writeReference(ctx.root, mesh);
      return { name, directory, kind: 'file', triangles: mesh.meta.triangles, vertices: mesh.meta.vertices, groups: mesh.meta.groups, bounds: mesh.meta.bounds, parts: mesh.meta.parts.length };
    }
    const { vehicleId } = await import('../../../tools/ship-overlay/reference');
    const vehicle = vehicleId(source);
    name = referenceName(ctx.option('--name') ?? vehicle);
    if (!ctx.has('--refresh')) {
      const existing = await readReferenceMeta(ctx.root, name).catch(() => undefined);
      if (existing) return ctx.has('--render') ? render(ctx, existing) : { name, directory: reference.referenceDirectory(ctx.root, name), cached: true, ...summarize(existing) };
    }
    const { assembleReference, defaultComponents, isHullConfiguration } = await import('../../../tools/ship-overlay/reference');
    const { loadReference } = await import('../../../tools/ship-overlay/download');
    const pack = await loadReference(ctx.root, vehicle);
    const hulls = Object.keys(pack.scheme).filter(isHullConfiguration).sort();
    const hull = ctx.option('--hull') ?? (hulls.includes('A_Hull') ? 'A_Hull' : hulls[0]);
    if (!hull || !pack.scheme[hull]) throw new Error('Unknown hull configuration. Available: ' + (hulls.join(', ') || 'none') + '.');
    const chosen = ctx.option('--components');
    const components = ctx.has('--hull-only') ? [] : chosen ? chosen.split(',').map((item) => item.trim()).filter(Boolean) : defaultComponents(pack.scheme, hull);
    if (ctx.has('--hull-only') && chosen) throw new Error('--hull-only and --components are exclusive.');
    const unknown = components.filter((item) => !pack.scheme[item]);
    if (unknown.length) throw new Error('Unknown reference component ' + unknown.join(', ') + '. Available: ' + Object.keys(pack.scheme).sort().join(', ') + '.');
    const assembled = assembleParts(assembleReference(pack.scheme, hull, components), pack.models, scale ?? METRES_PER_UNIT);
    const mesh = packReference(assembled, {
      name, kind: 'gamemodels3d', source: pack.url, vehicle, vehicleName: pack.name, fetchedAt: pack.fetchedAt, hull, components,
      frame: { metresPerUnit: scale ?? METRES_PER_UNIT, reflectedZ: true, waterlineY: 0, axes: '+X starboard, +Y up (y=0 waterline), −Z bow, metres' },
    });
    const directory = await writeReference(ctx.root, mesh);
    if (ctx.has('--render')) return render(ctx, mesh.meta);
    return {
      name, directory, kind: 'gamemodels3d', vehicle, vehicleName: pack.name, hull, components,
      available: { hulls, components: Object.keys(pack.scheme).filter((key) => !isHullConfiguration(key)).sort() },
      ...summarize(mesh.meta),
      note: 'Viewing reference only: downloaded geometry stays in ignored .build/ and is never committed. Source y = 0 is taken as the waterline and is unverified.',
    };
  },
} satisfies CliCommand;

/** `--render`: textured views of the cached configuration, framed like ship:overlay and ui:shot. */
async function render(ctx: Parameters<CliCommand['run']>[0], meta: import('../reference').ReferenceMeta) {
  const { renderReference } = await import('../referenceRender');
  const { parseCameraPose, parseVec3 } = await import('../../browser/cameraPoses');
  const numeric = (flag: string) => {
    const value = ctx.option(flag);
    if (value === undefined) return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(flag + ' expects a positive number.');
    return parsed;
  };
  const eye = ctx.option('--eye'), target = ctx.option('--target'), camera = ctx.option('--camera');
  if (eye && camera) throw new Error('--camera and --eye are exclusive.');
  if (target && !eye && !camera) throw new Error('--target needs --eye or --camera.');
  const targetPoint = target ? parseVec3(target, '--target') : undefined;
  const pose = eye ? { eye: parseVec3(eye, '--eye'), ...(targetPoint ? { target: targetPoint } : {}) }
    : camera ? (() => { const parsed = parseCameraPose(camera); return typeof parsed === 'string' ? { preset: parsed, ...(targetPoint ? { target: targetPoint } : {}) } : { ...parsed, ...(targetPoint ? { target: targetPoint } : {}) }; })()
    : undefined;
  const offsetText = ctx.option('--offset');
  const offsetValues = offsetText?.split(',').map(Number);
  if (offsetValues && (![1, 3].includes(offsetValues.length) || offsetValues.some((v) => !Number.isFinite(v)))) throw new Error('--offset takes z or x,y,z in metres.');
  const offset = offsetValues ? (offsetValues.length === 1 ? [0, 0, offsetValues[0]] : offsetValues) as [number, number, number] : undefined;
  const result = await renderReference(ctx.root, meta, {
    shots: ctx.option('--shots')?.split(',').map((item) => item.trim()).filter(Boolean),
    camera: pose as import('../../browser/cameraPoses').CameraPose | undefined, fov: numeric('--fov'), ortho: numeric('--ortho'),
    paint: ctx.option('--paint'), offset, parts: ctx.option('--parts')?.split(',').map((item) => item.trim()).filter(Boolean),
    out: ctx.option('--out'),
  });
  return { name: meta.name, vehicle: meta.vehicle, hull: meta.hull, measurement: 'textured-render', ...result, note: 'Viewing reference only: renders stay in ignored .build/.' };
}

const summarize = (meta: import('../reference').ReferenceMeta) => ({
  triangles: meta.triangles, vertices: meta.vertices, hullTriangles: meta.hullTriangles, groups: meta.groups,
  bounds: meta.bounds, parts: meta.parts.length, hardpoints: meta.hardpoints.length, omitted: meta.omitted.length ? meta.omitted : undefined,
});
