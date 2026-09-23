import type { CliCommand } from '../command';

export default {
  summary:
    'mesh.obj|stl|ply|glb --id new-id [--label text] [--at x,y,z] [--scale n|sx,sy,sz] [--up y|z|blender] [--bearing deg] ' +
    '[--group name] [--weld m] [--max-parts n] [--max-planes n] [--out batch.json] — import a closed triangle mesh ' +
    'as one compound-solid hull block: welds and checks it, decomposes it into convex parts, and proposes a ' +
    'revision-guarded batch validated by a native dry-run; never saves',
  values: ['--id', '--label', '--at', '--scale', '--up', '--bearing', '--group', '--weld', '--max-parts', '--max-planes', '--out'],
  positionals: 1,
  async run(ctx) {
    const { basename, resolve } = await import('node:path');
    const { readFile, writeFile } = await import('node:fs/promises');
    const { parseMeshFile } = await import('../meshFile');
    const { meshToSolid } = await import('../meshSolid');
    const { readSource } = await import('../files');
    const { compileConstruction } = await import('../compiler');
    const { applyConstructionBatch } = await import('../../../src/ships/constructionCommands');
    const { emit } = await import('../query');
    const { fromBlender, degrees360 } = await import('../blenderFrame');

    const file = ctx.positionals[0];
    if (!file) throw new Error('Provide the mesh file to import (.obj, .stl, .ply or .glb).');
    const id = ctx.option('--id');
    if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error('Provide --id <new primitive id> of 1–64 ASCII letters, digits, - or _.');
    const numbers = (flag: string, counts: number[]) => {
      const value = ctx.option(flag);
      if (value === undefined) return undefined;
      const parsed = value.split(',').map((v) => (v.trim() === '' ? NaN : Number(v)));
      if (!counts.includes(parsed.length) || !parsed.every(Number.isFinite))
        throw new Error(`${flag} expects ${counts.join(' or ')} comma-separated finite numbers.`);
      return parsed;
    };
    const at = (numbers('--at', [3]) ?? [0, 0, 0]) as [number, number, number];
    const scaleValue = numbers('--scale', [1, 3]);
    const scale = (scaleValue?.length === 1 ? [scaleValue[0], scaleValue[0], scaleValue[0]] : scaleValue) ?? [1, 1, 1];
    if (scale.some((n) => n === 0)) throw new Error('--scale cannot be zero on any axis.');
    const up = ctx.option('--up') ?? 'y';
    if (up !== 'y' && up !== 'z' && up !== 'blender')
      throw new Error('--up expects y (ship convention), z (most CAD exports) or blender (this repository\'s Blender frame: +X bow, +Y port, +Z up).');
    // Clockwise from the bow, as for equipment; a hull piece's rotationDeg turns the other way.
    const bearing = numbers('--bearing', [1])?.[0] ?? 0;

    const bytes = new Uint8Array(await readFile(resolve(file)));
    if (bytes.byteLength > 64 * 1024 * 1024) throw new Error('Mesh files are limited to 64 MB.');
    const parsed = parseMeshFile(basename(file), bytes);
    // Each frame change is a rotation, so it keeps handedness and winding: a Z-up file turns +Z up
    // to +Y and +Y to −Z (the glTF convention), and the Blender frame uses the shared conversion.
    const rotate = (v: readonly number[]): [number, number, number] => (up === 'z' ? [v[0], v[2], -v[1]] : up === 'blender' ? fromBlender(v) : [v[0], v[1], v[2]]);
    const place = (v: readonly number[]): [number, number, number] => rotate([v[0] * scale[0], v[1] * scale[1], v[2] * scale[2]]);
    // Each negative scale axis reverses handedness; an odd number of them turns every triangle
    // inside out, so the winding has to be reversed with them.
    const mirrored = scale.filter((n) => n < 0).length % 2 === 1;
    const group = ctx.option('--group');
    const triangles = parsed.triangles.map((t) => ({
      a: place(t.a),
      b: place(mirrored ? t.c : t.b),
      c: place(mirrored ? t.b : t.c),
      ...(group ? { group } : t.group ? { group: t.group } : {}),
    }));
    const report = meshToSolid(triangles, {
      label: ctx.option('--label') ?? parsed.groups[0] ?? basename(file),
      weldM: numbers('--weld', [1])?.[0],
      maxParts: numbers('--max-parts', [1])?.[0],
      maxPlanes: numbers('--max-planes', [1])?.[0],
    });

    const current = await readSource(ctx.root, ctx.id);
    if (current.source.construction.primitives.some((p) => p.id === id))
      throw new Error(`The design already has a piece called ${id}. Choose another --id, or remove that piece first.`);
    const value = {
      id,
      kind: 'vertex' as const,
      // The mesh's own envelope centre lands exactly on --at; the report says where that centre
      // was in the file, so a re-import of the same mesh is reproducible.
      size: report.size,
      position: at,
      rotationDeg: degrees360(-bearing),
      solid: report.solid,
    };
    const batch = {
      version: 1 as const,
      expectedRevision: current.source.revision,
      expectedFileHash: current.hash,
      label: `Import ${basename(file)} as ${id}`,
      commands: [{ op: 'primitive' as const, value }],
    };
    const result = await compileConstruction(ctx.root, applyConstructionBatch(current.source, batch));
    if (!result.definition) process.exitCode = 1;
    const out = ctx.option('--out');
    if (out && result.definition) await writeFile(resolve(out), JSON.stringify(batch, null, 2) + '\n', { flag: 'wx' });
    emit({
      id: ctx.id,
      revision: current.source.revision,
      fileRevision: current.hash,
      saved: false,
      imported: {
        file: basename(file),
        format: parsed.format,
        triangles: report.triangles,
        weldedVertices: report.welded,
        cuttingPlanes: report.planes,
        parts: report.parts,
        volumeM3: Number(report.volumeM3.toFixed(4)),
        size: report.size,
        position: at,
        sourceCenter: report.center,
        groups: [...new Set(report.solid.parts.flatMap((p) => p.faces.map((f) => f.group)).filter(Boolean))],
        notes: report.notes,
      },
      candidate: { launchable: !!result.definition, diagnostics: result.diagnostics },
      ...(out && result.definition ? { batchPath: resolve(out) } : {}),
      next: result.definition
        ? `Apply it with: bun run ship:apply ${ctx.id} <batch.json> (use --out to write the batch)`
        : 'The candidate does not compile; the diagnostics name the piece and what it collides with.',
      batch,
    });
  },
} satisfies CliCommand;
