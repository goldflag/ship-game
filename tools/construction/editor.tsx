import { createRoot } from 'react-dom/client';
import '@fontsource/barlow/400.css';
import '@fontsource/barlow-condensed/500.css';
import '../../src/ui/styles.css';
import { Shipbuilder } from '../../src/ui/shipbuilding/Shipbuilder';
import { openConstructionRepository } from '../../src/ships/constructionRepository';
import { loadSavedConstructionWithCatalog } from '../../src/ships/constructionEditor';
import { downloadConstructionSource } from '../../src/ui/shipbuilding/DesignsMenu';
import type { ConstructionSource } from '../../src/ships/blueprint';

/** Fast authoring entry: the existing editor opens without preparing the ocean. */
async function start() {
  const id = new URLSearchParams(location.search).get('ship');
  if (!id) throw new Error('Choose a repository ship with bun run ship:edit <id>.');
  const store = await openConstructionRepository();
  const loaded = await loadSavedConstructionWithCatalog(store, id);
  store.close();
  createRoot(document.getElementById('root')!).render(<Shipbuilder
    catalog={loaded.catalog} initialSource={loaded.source} repositoryId={id} openStore={openConstructionRepository}
    onEditorReady={editor => { window.constructionEditor = editor; }}
    onClose={() => { location.assign('/'); }}
    onLaunch={async (source: ConstructionSource) => {
      const key = crypto.randomUUID();
      try { sessionStorage.setItem('construction-trial.' + key, JSON.stringify(source)); }
      catch { downloadConstructionSource(JSON.stringify(source, null, 2), source.name); throw new Error('The trial draft could not be transferred. A backup was downloaded; save the repository source and retry.'); }
      location.assign('/?construction=' + encodeURIComponent(id) + '&constructionTrial=' + key);
    }}
  />);
}
void start().catch(error => {
  const host = document.getElementById('root')!;
  const message = document.createElement('p'); message.setAttribute('role', 'alert');
  message.textContent = error instanceof Error ? error.message : String(error);
  host.append(message);
});
