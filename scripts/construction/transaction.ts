import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { ConstructionResult, ConstructionSource } from '../../src/ships/blueprint';
import { applyConstructionBatch, type ConstructionBatch, type ConstructionCommand } from '../../src/ships/constructionCommands';
import type { CommandContext } from './command';
import { repositoryStore } from './files';

export type GuardedBatch = ConstructionBatch & { expectedFileHash: string };
export interface CurrentSource {
  source: ConstructionSource;
  hash: string;
}

/** A batch guarded by the revisions observed in this process. The save still fails if the file
 * changed after the read, so building the guards here is as atomic as copying them by hand. */
export const guardedBatch = (current: CurrentSource, label: string, commands: ConstructionCommand[]): GuardedBatch => ({
  version: 1,
  expectedRevision: current.source.revision,
  expectedFileHash: current.hash,
  label,
  commands,
});

/** The transaction `ship:apply` performs: both revision checks, then one atomic repository save. */
export async function saveBatch(root: string, id: string, current: CurrentSource, batch: GuardedBatch) {
  if (batch.expectedFileHash !== current.hash)
    throw new Error('File revision changed. Inspect the source and update the batch before retrying.');
  const next = applyConstructionBatch(current.source, batch);
  const revision = await repositoryStore(root).save({
    designId: id,
    source: next,
    name: next.name,
    schemaVersion: 1,
    catalogRevision: next.construction.catalogRevision,
    expectedRevisionId: current.hash,
  });
  return { saved: true, revision: next.revision, fileRevision: revision.id };
}

/** The per-record `contributions` list is hundreds of rows; a generated batch is judged on the totals.
 * `ship:inspect` still prints the full loading for the record that needs it. */
const totals = (loading: NonNullable<ConstructionResult['loading']>) => {
  const { contributions: _contributions, basis: _basis, ...rest } = loading;
  return rest;
};

/** The shared tail of a command that generates a batch rather than resolving seats: compile the exact
 * candidate natively, write `--out`, and save only under `--apply`. `ship:place` keeps its own richer
 * version in `placement.ts` because it also reports seat resolution. */
export async function proposeCommands(
  ctx: CommandContext,
  current: CurrentSource,
  label: string,
  commands: ConstructionCommand[],
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const { compileConstruction } = await import('./compiler');
  const batch = guardedBatch(current, label, commands);
  const candidate: ConstructionResult | undefined = commands.length
    ? await compileConstruction(ctx.root, applyConstructionBatch(current.source, batch))
    : undefined;
  const launchable = !commands.length || !!candidate?.definition;
  const out = ctx.option('--out');
  if (out && launchable && commands.length) await writeFile(resolve(out), JSON.stringify(batch, null, 2) + '\n', { flag: 'wx' });
  if (!launchable) process.exitCode = 1;
  const applied =
    !ctx.has('--apply') || !commands.length
      ? {}
      : launchable
        ? await saveBatch(ctx.root, ctx.id, current, batch)
        : { saved: false, reason: 'The candidate does not compile; nothing was written.' };
  return {
    id: ctx.id,
    revision: current.source.revision,
    fileRevision: current.hash,
    saved: false,
    ...extra,
    candidate: candidate
      ? {
          launchable: !!candidate.definition,
          ...(candidate.loading ? { loading: totals(candidate.loading) } : {}),
          diagnostics: candidate.diagnostics,
        }
      : { compiled: false, reason: 'Nothing to change.' },
    batch: launchable && commands.length ? batch : null,
    ...(out && launchable && commands.length ? { out: resolve(out), next: 'bun run ship:apply ' + ctx.id + ' ' + out + ' --dry-run' } : {}),
    ...applied,
  };
}

/** `--commands` reads a bare array, or `{label?, commands: [...]}`. A guarded batch belongs in the
 * positional argument instead, where its own expectations are honoured rather than replaced. */
export function unguardedCommands(document: unknown): { label?: string; commands: ConstructionCommand[] } {
  if (Array.isArray(document)) return { commands: document as ConstructionCommand[] };
  if (document && typeof document === 'object') {
    const record = document as Record<string, unknown>;
    if ('expectedRevision' in record || 'expectedFileHash' in record)
      throw new Error('--commands takes an unguarded command list; pass an already guarded batch as the positional argument instead.');
    if (Array.isArray(record.commands))
      return { commands: record.commands as ConstructionCommand[], ...(typeof record.label === 'string' ? { label: record.label } : {}) };
  }
  throw new Error('--commands expects a JSON array of commands, or an object with a `commands` array.');
}
