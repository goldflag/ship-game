import type { CliCommand } from '../command';

export default {
  summary:
    'mesh.obj|stl|ply|glb --id fit-new --name text --mass kg [--at x,z [--y height | --on id] [--bearing deg] [--instance id]] ' +
    '[--paint group=paint,…] [--scale n|sx,sy,sz] [--up y|z] [--label text] [--out batch.json] — import any triangle mesh ' +
    '(open or non-convex) as a visual mesh custom fitting: centred on its footprint with its lowest point on the datum, ' +
    'quantized and encoded (deflate-q16-u16-v1), split into meshes of at most 20,000 triangles, checked against the design ' +
    'budgets (100,000 unique mesh triangles, 1 MiB encoded, 1,000,000 drawn); material or group names become paintable ' +
    'groups. --at also seats one instance. Visual plus mass only: never hull, armor or hit geometry. Proposes a ' +
    'revision-guarded batch validated by a native dry-run; never saves. Pass --out for large meshes: the report then leaves the ' +
    'encoded batch out (long MCP output is truncated)',
  values: ['--id', '--name', '--mass', '--at', '--y', '--on', '--bearing', '--instance', '--paint', '--scale', '--up', '--label', '--out'],
  positionals: 1,
  async run(ctx) {
    const { basename, resolve } = await import('node:path');
    const { readFile } = await import('node:fs/promises');
    const { parseMeshFile } = await import('../meshFile');
    const { readSource, readCatalog } = await import('../files');
    const { resolvePlacement, proposeBatch } = await import('../placement');
    const { applyConstructionBatch } = await import('../../../src/ships/constructionCommands');
    const { placementItems, placementCommands } = await import('../../../src/ships/constructionPlacement');
    const { encodeFittingMesh, FITTING_MESH_LIMITS } = await import('../../../src/ships/constructionFittingMesh');
    const { customFittingBudgets, resolvedCustomFitting, customFittingPartId } =
      await import('../../../src/ships/constructionCustomFittings');
    const { CONSTRUCTION_PAINTS } = await import('../../../src/ships/constructionPaints');
    const { emit } = await import('../query');

    const file = ctx.positionals[0];
    if (!file) throw new Error('Provide the mesh file to import (.obj, .stl, .ply or .glb).');
    const id = ctx.option('--id');
    if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id))
      throw new Error('Provide --id <new definition id> of 1–64 ASCII letters, digits, - or _.');
    const numbers = (flag: string, counts: number[]) => {
      const value = ctx.option(flag);
      if (value === undefined) return undefined;
      const parsed = value.split(',').map((v) => (v.trim() === '' ? NaN : Number(v)));
      if (!counts.includes(parsed.length) || !parsed.every(Number.isFinite))
        throw new Error(`${flag} expects ${counts.join(' or ')} comma-separated finite numbers.`);
      return parsed;
    };
    const massKg = numbers('--mass', [1])?.[0];
    if (massKg === undefined || !(massKg >= 0.001 && massKg <= 1_000_000))
      throw new Error('Provide --mass <kg> of 0.001–1,000,000: a visual mesh has no volume, so its weight is stated.');
    const scaleValue = numbers('--scale', [1, 3]);
    const scale = (scaleValue?.length === 1 ? [scaleValue[0], scaleValue[0], scaleValue[0]] : scaleValue) ?? [1, 1, 1];
    // A negative scale would mirror the mesh; turn it with --bearing instead, or mirror it in the modelling tool.
    if (scale.some((n) => !(n > 0))) throw new Error('--scale must be positive on every axis.');
    const up = ctx.option('--up') ?? 'y';
    if (up !== 'y' && up !== 'z') throw new Error('--up expects y (ship convention) or z (Blender and most CAD exports).');
    const paints: Record<string, string> = {};
    for (const entry of ctx.option('--paint')?.split(',') ?? []) {
      const at = entry.lastIndexOf('='),
        group = entry.slice(0, at).trim(),
        paint = entry.slice(at + 1).trim();
      if (at < 1 || !paint) throw new Error(`--paint expects group=paint pairs separated by commas; got "${entry}".`);
      if (!CONSTRUCTION_PAINTS.some((p) => p.id === paint))
        throw new Error(`Unknown paint ${paint}; use one of ${CONSTRUCTION_PAINTS.map((p) => p.id).join(', ')}.`);
      paints[group] = paint;
    }

    const bytes = new Uint8Array(await readFile(resolve(file)));
    if (bytes.byteLength > 64 * 1024 * 1024) throw new Error('Mesh files are limited to 64 MB.');
    const parsed = parseMeshFile(basename(file), bytes);
    const unknown = Object.keys(paints).filter((group) => !parsed.groups.includes(group));
    if (unknown.length)
      throw new Error(
        `--paint names ${unknown.join(', ')}, which the file does not have; its groups are ${parsed.groups.join(', ') || 'none'}.`,
      );
    // Z-up files turn −90° about X into Y-up: a rotation, so nothing is mirrored and the winding holds.
    const turned = (v: readonly number[]): [number, number, number] =>
      up === 'z' ? [v[0] * scale[0], v[2] * scale[2], -v[1] * scale[1]] : [v[0] * scale[0], v[1] * scale[1], v[2] * scale[2]];
    const soup = parsed.triangles.map((t) => ({ a: turned(t.a), b: turned(t.b), c: turned(t.c), group: t.group }));
    // The datum is the middle of the footprint, at the lowest point: the fitting seats where it stands.
    const lo = [Infinity, Infinity, Infinity],
      hi = [-Infinity, -Infinity, -Infinity];
    for (const t of soup)
      for (const p of [t.a, t.b, t.c]) for (let k = 0; k < 3; k++) [lo[k], hi[k]] = [Math.min(lo[k], p[k]), Math.max(hi[k], p[k])];
    const origin: [number, number, number] = [(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2];
    const local = (p: [number, number, number]): [number, number, number] => [p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]];
    const placed = soup.map((t) => ({ a: local(t.a), b: local(t.b), c: local(t.c), group: t.group }));
    const size = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
    if (size.some((n) => n > 100))
      throw new Error(
        `The mesh spans ${size.map((n) => n.toFixed(2)).join(' × ')} m; a fitting spans at most 100 m. Check --scale (a file in centimetres needs --scale 0.01).`,
      );

    // Meshes of at most 20,000 triangles, in group order so each group stays in as few meshes as possible.
    const L = FITTING_MESH_LIMITS;
    const order = [...new Set(placed.map((t) => t.group))];
    const sorted = placed
      .map((t, i) => [t, i] as const)
      .sort(([a, i], [b, j]) => order.indexOf(a.group) - order.indexOf(b.group) || i - j)
      .map(([t]) => t);
    const chunks = Math.ceil(sorted.length / L.meshTriangles);
    if (chunks > L.meshes)
      throw new Error(
        `The mesh has ${sorted.length} triangles, which needs ${chunks} meshes of at most ${L.meshTriangles}; a definition holds ${L.meshes}. Simplify it in a modelling tool first.`,
      );
    const meshes = Array.from({ length: chunks }, (_, n) =>
      encodeFittingMesh(chunks === 1 ? 'mesh' : `mesh-${n + 1}`, sorted.slice(n * L.meshTriangles, (n + 1) * L.meshTriangles), paints),
    );
    const definition = {
      id,
      name: (ctx.option('--name') ?? basename(file).replace(/\.[^.]+$/, '')).slice(0, 80),
      version: 2 as const,
      attach: 'deck' as const,
      solids: [],
      tubes: [],
      massKg,
      meshes,
    };

    const current = await readSource(ctx.root, ctx.id);
    const data = current.source.construction;
    if ([...data.primitives, ...data.equipment, ...data.boundaries, ...data.loads, ...(data.fittings ?? [])].some((row) => row.id === id))
      throw new Error(`The design already has a record called ${id}. Choose another --id, or remove that record first.`);
    const resolved = resolvedCustomFitting(definition);
    const before = customFittingBudgets(data);
    const triangles = meshes.reduce((sum, m) => sum + m.triangles, 0),
      encoded = meshes.reduce((sum, m) => sum + m.data.length, 0);
    const over = [
      before.meshTriangles + triangles > L.designMeshTriangles &&
        `unique mesh triangles would be ${before.meshTriangles + triangles} (${triangles} of them this mesh); the design limit is ${L.designMeshTriangles}`,
      before.meshBytes + encoded > L.designMeshBytes &&
        `encoded mesh bytes would be ${before.meshBytes + encoded} (${encoded} of them this mesh); the design limit is ${L.designMeshBytes}`,
      ctx.option('--at') !== undefined &&
        before.renderedTriangles + resolved.triangles > L.renderedTriangles &&
        `drawn custom fitting triangles would be ${before.renderedTriangles + resolved.triangles}; the design limit is ${L.renderedTriangles}`,
    ].filter(Boolean);
    if (over.length)
      throw new Error(
        `Over budget: ${over.join('; ')}. Simplify the mesh in a modelling tool, or remove other mesh fittings. Nothing was changed.`,
      );

    const fitting = { op: 'fitting' as const, value: definition };
    let commands = [fitting] as Parameters<typeof proposeBatch>[3];
    let report: Awaited<ReturnType<typeof resolvePlacement>> = { placements: [], diagnostics: [] };
    const at = numbers('--at', [2]);
    if (at) {
      const catalog = await readCatalog(ctx.root, data.catalogRevision);
      const candidate = applyConstructionBatch(current.source, {
        version: 1,
        expectedRevision: current.source.revision,
        label: 'Define',
        commands: [fitting],
      });
      const items = placementItems(candidate, catalog, {
        partId: customFittingPartId(id),
        at: at as [number, number],
        y: numbers('--y', [1])?.[0],
        on: ctx.option('--on'),
        bearingDeg: numbers('--bearing', [1])?.[0],
        id: ctx.option('--instance'),
      });
      report = await resolvePlacement(ctx.root, candidate, items);
      if (!report.diagnostics.some((d) => d.severity === 'error')) commands = [fitting, ...placementCommands(items, report.placements)];
    } else if (['--y', '--on', '--bearing', '--instance'].some((flag) => ctx.option(flag) !== undefined))
      throw new Error('--y, --on, --bearing and --instance place an instance; give --at x,z as well.');
    const proposed = await proposeBatch(ctx, current, ctx.option('--label') ?? `Import ${basename(file)} as ${id}`, commands, report, {
      imported: {
        file: basename(file),
        format: parsed.format,
        triangles,
        vertices: meshes.reduce((sum, m) => sum + m.vertices, 0),
        droppedTriangles: parsed.triangles.length - triangles,
        meshes: meshes.length,
        encodedBytes: encoded,
        size: size.map((n) => Number(n.toFixed(4))),
        sourceOrigin: origin.map((n) => Number(n.toFixed(4))),
        groups: meshes.flatMap((m) =>
          (m.groups ?? []).map((g) => ({ mesh: m.id, name: g.name, triangles: g.count, ...(g.paint ? { paint: g.paint } : {}) })),
        ),
        centerOfGravity: resolved.part.centerOfGravity.map((n) => Number(n.toFixed(4))),
        budgets: {
          meshTriangles: { used: before.meshTriangles + triangles, limit: L.designMeshTriangles },
          meshBytes: { used: before.meshBytes + encoded, limit: L.designMeshBytes },
          renderedTriangles: { used: before.renderedTriangles + (at ? resolved.triangles : 0), limit: L.renderedTriangles },
        },
      },
    });
    // The encoded payload can reach a megabyte: with --out the file carries the batch and the report leaves it out.
    emit('out' in proposed && proposed.out ? { ...proposed, batch: `written to ${proposed.out}` } : proposed);
  },
} satisfies CliCommand;
