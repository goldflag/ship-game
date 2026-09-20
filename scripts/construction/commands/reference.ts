import type { CliCommand } from '../command';

/** Fetch or reuse a reference vehicle and cache it as a ship-frame triangle mesh for slice, loft, hardpoints and compare. */
export default {
  summary:
    '<vehicle-id|vehicle-url|file.glb|file.obj> [--name cache-name] [--hull A_Hull] [--components A_Artillery,…] [--hull-only] [--refresh] ' +
    '[--scale 15] [--flip-z] [--list] — cache a GameModels3D vehicle (network) or a local GLB/OBJ as a ship-frame mesh in ' +
    '.build/references/<name>/ (+X starboard, +Y up with y=0 the waterline, −Z bow, metres); --list prints what is already cached',
  ship: false,
  positionals: 1,
  values: ['--name', '--hull', '--components', '--scale'],
  switches: ['--hull-only', '--refresh', '--flip-z', '--list'],
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
      if (existing) return { name, directory: reference.referenceDirectory(ctx.root, name), cached: true, ...summarize(existing) };
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
    return {
      name, directory, kind: 'gamemodels3d', vehicle, vehicleName: pack.name, hull, components,
      available: { hulls, components: Object.keys(pack.scheme).filter((key) => !isHullConfiguration(key)).sort() },
      ...summarize(mesh.meta),
      note: 'Viewing reference only: downloaded geometry stays in ignored .build/ and is never committed. Source y = 0 is taken as the waterline and is unverified.',
    };
  },
} satisfies CliCommand;

const summarize = (meta: import('../reference').ReferenceMeta) => ({
  triangles: meta.triangles, vertices: meta.vertices, hullTriangles: meta.hullTriangles, groups: meta.groups,
  bounds: meta.bounds, parts: meta.parts.length, hardpoints: meta.hardpoints.length, omitted: meta.omitted.length ? meta.omitted : undefined,
});
