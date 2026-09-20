import { join, resolve } from 'node:path';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import type { ConstructionDiagnostic, ConstructionSource } from '../../src/ships/blueprint';
import type { Placement, PlacementItem } from '../../src/ships/constructionPlacement';
import { applyConstructionBatch, type ConstructionCommand } from '../../src/ships/constructionCommands';
import type { CommandContext } from './command';
import { readCatalog } from './files';
import { compileConstruction } from './compiler';

export interface PlacementReport {
  placements: Placement[];
  diagnostics: ConstructionDiagnostic[];
}

/** Native seat resolution against the hull the compiler builds; shared by `place` and `reseat`. */
export async function resolvePlacement(root: string, source: ConstructionSource, items: PlacementItem[]): Promise<PlacementReport> {
  const catalog = await readCatalog(root, source.construction.catalogRevision);
  const directory = join(root, '.build/construction/place', crypto.randomUUID());
  await mkdir(directory, { recursive: true });
  try {
    const files = { source, catalog, request: { items } },
      paths = Object.keys(files).map((name) => join(directory, name + '.json'));
    await Promise.all(Object.values(files).map((value, i) => writeFile(paths[i], JSON.stringify(value))));
    const localCargo = join(homedir(), '.cargo/bin', process.platform === 'win32' ? 'cargo.exe' : 'cargo');
    const child = spawn(
      existsSync(localCargo) ? localCargo : 'cargo',
      ['run', '--quiet', '--locked', '--profile', 'wasm-dev', '-p', 'naval-sim', '--example', 'place_construction', '--', ...paths],
      { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const timer = setTimeout(() => child.kill(), 600_000);
    try {
      let stdout = '',
        stderr = '';
      child.stdout.on('data', (data) => {
        stdout += data;
      });
      child.stderr.on('data', (data) => {
        stderr += data;
      });
      const code = await new Promise<number | null>((done, reject) => {
        child.on('error', reject);
        child.on('close', done);
      });
      if (code !== 0) throw new Error('Native placement failed: ' + stderr.slice(-4000));
      return JSON.parse(stdout);
    } finally {
      clearTimeout(timer);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** One line per record: where it sits, on what, and how far it was from it. */
const brief = (p: Placement, measured: boolean) => ({
  id: p.id,
  partId: p.partId,
  status: p.status,
  position: p.position,
  bearingDeg: p.bearingDeg,
  ...(measured && p.status !== 'mirrored' && p.gapM !== undefined ? { from: p.from, gapM: p.gapM } : {}),
  ...(p.residualM ? { residualM: p.residualM } : p.status === 'mirrored' ? { residualM: 0 } : {}),
  ...(p.support
    ? {
        support: {
          kind: p.support.kind,
          id: p.support.primitiveId ?? p.support.id,
          face: p.support.face,
          panelId: p.support.panelId,
          point: p.support.point,
          slopeDeg: Number(((Math.acos(Math.min(1, Math.abs(p.support.normal[1]))) * 180) / Math.PI).toFixed(2)),
        },
      }
    : {}),
  ...(p.message ? { message: p.message } : {}),
});

/** Never saves. Builds the guarded batch, applies it in memory and compiles exactly that candidate natively. */
export async function proposeBatch(
  ctx: CommandContext,
  current: { source: ConstructionSource; hash: string },
  label: string,
  commands: ConstructionCommand[],
  report: PlacementReport,
  extra: Record<string, unknown> = {},
  measured = true,
) {
  const { source } = current;
  const failed = report.diagnostics.some((d) => d.severity === 'error');
  const batch = { version: 1 as const, expectedRevision: source.revision, expectedFileHash: current.hash, label, commands };
  const result = failed || !commands.length ? undefined : await compileConstruction(ctx.root, applyConstructionBatch(source, batch));
  const touched = new Set(commands.map((c) => (c.op === 'equipment' ? c.value.id : c.op === 'equipment-patch' ? c.id : '')));
  // The compiler stops at its first fatal error. One that names another record leaves these seats
  // unverified rather than wrong, so the batch is still offered, flagged, with a failing exit code.
  const blocker = result && !result.definition ? result.diagnostics.find((d) => d.severity === 'error') : undefined;
  const unrelated = !!blocker && blocker.sourceId !== undefined && !touched.has(blocker.sourceId);
  const launchable = !commands.length || !!result?.definition;
  const valid = !failed && (launchable || unrelated);
  const out = ctx.option('--out');
  if (out && valid && commands.length) await writeFile(resolve(out), JSON.stringify(batch, null, 2) + '\n', { flag: 'wx' });
  if (failed || !launchable) process.exitCode = 1;
  return {
    id: ctx.id,
    revision: source.revision,
    fileRevision: current.hash,
    saved: false,
    placements: report.placements.map((p) => brief(p, measured)),
    ...extra,
    diagnostics: report.diagnostics,
    candidate: result
      ? {
          launchable: !!result.definition,
          diagnostics: result.diagnostics,
          ...(unrelated
            ? {
                unverified:
                  'The candidate stops at an error on ' +
                  blocker!.sourceId +
                  ', which this batch does not touch; fix it, then dry-run this batch again.',
              }
            : {}),
        }
      : {
          compiled: false,
          reason: failed
            ? 'No candidate: at least one record has no seat.'
            : 'Nothing to change: every record already sits on its support.',
        },
    batch: valid && commands.length ? batch : null,
    ...(out && valid && commands.length ? { out: resolve(out), next: 'bun run ship:apply ' + ctx.id + ' ' + out + ' --dry-run' } : {}),
  };
}
