import { createRoot } from 'react-dom/client';
import { Shipbuilder, type ConstructionEditorHandle } from '../../src/ui/shipbuilding/Shipbuilder';
import { loadConstructionCatalog } from '../../src/ships/constructionEquipment';
import { createStarterSource } from '../../src/ships/constructionStarter';
import type { ConstructionSource } from '../../src/ships/blueprint';
import '@fontsource/barlow/400.css';
import '@fontsource/barlow-condensed/500.css';
import '../../src/ui/styles.css';

let editor: ConstructionEditorHandle | undefined;
export function armamentEditor() {
  if (!editor) throw new Error('Editor is not ready');
  return editor;
}
/** Fresh browser storage only; exercises real native compilation and source persistence. */
export async function mountArmamentReview(legacy = false) {
  const catalog = await loadConstructionCatalog();
  const source: ConstructionSource = createStarterSource(catalog, 'patrol');
  if (legacy) {
    source.construction.version = 1;
    source.construction.equipment.push({ id: 'old-magazine', partId: 'generic-magazine-1000', position: [0, -2.484, -10], bearingDeg: 0 });
    source.construction.equipment.find(e => e.id === 'gun-forward')!.magazineId = 'old-magazine';
  }
  const host = document.createElement('div'); document.body.replaceChildren(host); document.body.style.margin = '0';
  const root = createRoot(host);
  root.render(<Shipbuilder catalog={catalog} initialSource={source} onEditorReady={handle => { editor = handle; }} onClose={() => root.unmount()} onLaunch={() => {}}/>);
  return () => root.unmount();
}
