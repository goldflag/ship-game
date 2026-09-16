import type { ConstructionSource } from '../../src/ships/blueprint';
import { openConstructionStore } from '../../src/ships/constructionStore';
import type { ConstructionRevision } from '../../src/ships/constructionStore';

/** Run only on a disposable authoring-check* source in the real repository editor. */
export async function checkRepositoryAuthoring(onConflict?: () => Promise<void>) {
  const until = async (condition: () => boolean, message: string) => {
    const end = performance.now() + 15_000;
    while (!condition()) { if (performance.now() > end) throw new Error(message); await new Promise(resolve => setTimeout(resolve, 30)); }
  };
  await until(() => !!window.constructionEditor?.result(), 'Editor is not ready');
  const initial = window.constructionEditor!.source(), id = initial.id;
  if (!id.startsWith('authoring-check')) throw new Error('Use a disposable authoring-check source.');
  const { token } = await (await fetch('/__construction')).json();
  const load = async () => (await (await fetch('/__construction/' + id)).json()) as { revision: ConstructionRevision };
  const save = async (source: ConstructionSource) => {
    const current = await load();
    const response = await fetch('/__construction/' + id, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-construction-token': token },
      body: JSON.stringify({ designId: id, source, name: source.name, schemaVersion: 1, catalogRevision: source.construction.catalogRevision, expectedRevisionId: current.revision.id }) });
    if (!response.ok) throw new Error(await response.text());
  };
  const checks: string[] = [];
  try {
    let editor = window.constructionEditor!;
    const next = editor.apply({ version: 1, expectedRevision: initial.revision, label: 'Agent batch', commands: [{ op: 'name', name: 'Browser batch' }] });
    if (editor.source().revision !== next.revision || editor.result() !== undefined) throw new Error('The editor handle exposed stale source or compiled output after apply');
    checks.push('The same editor handle reads the new source and rejects stale compilation immediately');
    await editor.flush();
    if (JSON.parse((await load()).revision.sourceJson).revision !== next.revision) throw new Error('Immediate apply/flush did not save the batch');
    checks.push('Immediate batch/flush writes the exact revision');
    await until(() => window.constructionEditor?.source().revision === next.revision, 'Batch did not reach the UI');
    const external = { ...next, revision: crypto.randomUUID(), name: 'External file edit' };
    await save(external);
    await until(() => window.constructionEditor?.source().revision === external.revision, 'External update did not reach live preview');
    checks.push('External source update refreshes the live editor without navigation');
    editor = window.constructionEditor!;
    const winner = { ...external, revision: crypto.randomUUID(), name: 'Competing file writer' };
    await save(winner);
    editor.apply({ version: 1, expectedRevision: external.revision, label: 'Conflicting draft', commands: [{ op: 'name', name: 'Unsaved browser draft' }] });
    let rejected = false;
    try { await editor.flush(); } catch { rejected = true; }
    if (!rejected || JSON.parse((await load()).revision.sourceJson).name !== winner.name) throw new Error('Stale browser save overwrote the file');
    await until(() => window.constructionEditor?.source().name === 'Unsaved browser draft', 'Conflicting draft was lost');
    checks.push('Conflicting autosave preserves both repository source and unsaved draft');
    await onConflict?.();
    const local = await openConstructionStore();
    try {
      const before = new Set((await local.list()).map(head => head.id));
      ([...document.querySelectorAll('.sb-repository-error button')].find(b => b.textContent === 'Save local copy') as HTMLButtonElement).click();
      await until(() => document.body.textContent!.includes('A saved copy is available'), 'Local-copy recovery did not finish');
      const copy = (await local.list()).find(head => !before.has(head.id));
      if (!copy || JSON.parse((await local.load(copy.id)).revision.sourceJson).name !== 'Unsaved browser draft') throw new Error('Recovery did not preserve draft in IndexedDB');
      if (window.constructionEditor!.source().id !== id || JSON.parse((await load()).revision.sourceJson).name !== winner.name) throw new Error('Recovery changed the repository identity or source');
      await local.remove(copy.id, copy.revisionId);
      checks.push('Conflict recovery saves an independent local copy and retains repository identity');
    } finally { local.close(); }

    (document.querySelector('.sb-meta') as HTMLButtonElement).click();
    await until(() => !![...document.querySelectorAll('button')].find(b => b.textContent === 'Reload repository'), 'Repository menu missing');
    ([...document.querySelectorAll('button')].find(b => b.textContent === 'Reload repository') as HTMLButtonElement).click();
    await until(() => window.constructionEditor?.source().revision === winner.revision, 'Explicit reload did not recover the file');
    window.constructionEditor!.undo();
    await until(() => window.constructionEditor?.source().name === 'Unsaved browser draft', 'Reload discarded the undoable draft');
    await window.constructionEditor!.flush();
    checks.push('Explicit reload keeps the rejected draft recoverable through undo');
  } finally {
    await save({ ...initial, revision: crypto.randomUUID() });
  }
  return { checks };
}
