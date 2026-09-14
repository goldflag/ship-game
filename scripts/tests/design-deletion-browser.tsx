import { createRoot, type Root } from 'react-dom/client';
import { controls, mountShipbuilderReview } from './shipbuilder-browser';
import { PortDesigns } from '../../src/ui/PortDesigns';
import { createStarterSource } from '../../src/ships/constructionStarter';
import { loadConstructionCatalog } from '../../src/ships/constructionEquipment';
import { openConstructionStore } from '../../src/ships/constructionStore';

/** Exercise confirmation, failure, active autosave and both saved-design lists with real IndexedDB. */
export async function checkDesignDeletion() {
  const checks: string[] = [], created = new Set<string>();
  const store = await openConstructionStore(), catalog = await loadConstructionCatalog();
  const wait = async (condition: () => unknown | Promise<unknown>, label: string) => {
    const start = performance.now();
    while (!await condition()) {
      if (performance.now() - start > 20000) throw new Error(`Timed out: ${label}`);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    checks.push(label);
  };
  const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.getAttribute('aria-label') === label);
  const saved = () => window.shipbuilderReview?.source;
  const absent = async (id: string) => !(await store.list()).some(design => design.id === id) && !(await store.revisions(id)).length;
  const rename = async (name: string) => {
    const input = document.querySelector<HTMLInputElement>('.sb-name')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, name);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(() => saved()?.name === name, 'renamed source saved');
  };
  let port: Root | undefined;
  try {
    window.shipbuilderReview?.close();
    const template = createStarterSource(catalog, 'blank'); template.name = `Deletion check ${crypto.randomUUID()}`;
    await mountShipbuilderReview(template);
    await wait(() => saved()?.name === template.name, 'deletion fixture saved');
    const firstId = saved()!.id; created.add(firstId);
    await controls.menu('New design');
    await wait(() => saved()?.id !== firstId, 'second design opens');
    const currentId = saved()!.id; created.add(currentId);
    const currentName = `Current deletion check ${crypto.randomUUID()}`;
    await rename(currentName);
    document.querySelector<HTMLButtonElement>('.sb-meta')!.click();
    await wait(() => button(`Delete ${template.name}`), 'editor exposes a Delete action per design');
    button(`Delete ${template.name}`)!.click();
    await wait(() => button(`Confirm delete ${template.name}`), 'Delete opens an inline confirmation');
    document.querySelector<HTMLButtonElement>('.design-delete[data-confirming=true] button:last-of-type')!.click();
    await wait(() => button(`Delete ${template.name}`), 'Cancel restores the delete action');
    if (!(await store.list()).some(design => design.id === firstId)) throw new Error('Cancel deleted the design');
    checks.push('Cancel preserves the design and saved revisions');

    // The menu now holds an old revision: another writer changes the design before confirmation.
    const previous = await store.load(firstId), source = JSON.parse(previous.revision.sourceJson);
    source.revision = crypto.randomUUID();
    await store.save({ designId: source.id, name: source.name, source, schemaVersion: 1,
      catalogRevision: source.construction.catalogRevision, expectedRevisionId: previous.head.revisionId });
    button(`Delete ${template.name}`)!.click();
    await wait(() => button(`Confirm delete ${template.name}`), 'stale design awaits confirmation');
    button(`Confirm delete ${template.name}`)!.click();
    await wait(() => document.querySelector('.design-delete [role=alert]')?.textContent?.includes('changed'), 'failed deletion reports the conflict inline');
    if (await absent(firstId)) throw new Error('Stale deletion removed the design');
    await wait(() => !button(`Confirm delete ${template.name}`)?.disabled, 'failure leaves confirmation retryable');
    button(`Confirm delete ${template.name}`)!.click();
    await wait(() => absent(firstId), 'retry deletes the refreshed design and all revisions');
    if (saved()!.id !== currentId) throw new Error('Deleting another design replaced the open source');
    checks.push('deleting another design keeps the current source open');

    button(`Delete ${currentName}`)!.click();
    await wait(() => button(`Confirm delete ${currentName}`), 'current design can be deleted from its row');
    button(`Confirm delete ${currentName}`)!.click();
    await wait(() => saved()?.id !== currentId && saved()?.construction.primitives.length === 1, 'deleting the open design starts a fresh one-block design');
    created.add(saved()!.id);
    await wait(() => absent(currentId) && !document.querySelector('.sb-menu'), 'open design deletion clears revisions and closes its menu');
    await new Promise(resolve => setTimeout(resolve, 300));
    if (!await absent(currentId)) throw new Error('Autosave recreated the deleted source');
    checks.push('the deleted current source stays deleted after autosave settles');
    const portId = saved()!.id, portName = `Port deletion check ${crypto.randomUUID()}`;
    await rename(portName);
    window.shipbuilderReview!.close();
    const host = document.createElement('div'); document.body.replaceChildren(host); port = createRoot(host);
    let notified = '';
    port.render(<PortDesigns ships={[]} selectedId="" ready preparing={false} onNew={() => {}} onEdit={() => {}} onInspect={() => {}} onDelete={id => { notified = id; }}/>);
    await wait(() => button(`Delete ${portName}`), 'port exposes a Delete action for saved drafts');
    button(`Delete ${portName}`)!.click();
    await wait(() => button(`Confirm delete ${portName}`), 'port confirms the named design');
    button(`Confirm delete ${portName}`)!.click();
    await wait(async () => await absent(portId) && !button(`Delete ${portName}`) && !button(`Confirm delete ${portName}`), 'port deletion removes the design from storage and its list');
    await wait(() => notified === portId, 'port reports the deleted design identity');
    checks.push('port deletion notifies the owning fleet');
    return { passed: checks.length, checks };
  } finally {
    port?.unmount(); window.shipbuilderReview?.close();
    for (const head of await store.list()) if (created.has(head.id)) await store.remove(head.id, head.revisionId);
    store.close();
  }
}
