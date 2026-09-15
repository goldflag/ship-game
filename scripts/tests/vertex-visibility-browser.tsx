/** Import through Vite and call checkVertexVisibility() on a blank page.
 * Exercises the real viewport/React/pointer flow with no storage or worker. */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as THREE from 'three';
import type { ConstructionCatalog, ConstructionResult, Vec3 } from '../../src/ships/blueprint';
import { createStarterSource } from '../../src/ships/constructionStarter';
import { CORNER_SIGNS, VERTEX_FACES, replaceVertexPrimitives } from '../../src/ships/constructionVertex';
import { BuilderViewport } from '../../src/ui/shipbuilding/BuilderViewport';
import '../../src/ui/shipbuilding/Shipbuilder.css';

type LiveViewport = { hull: THREE.Group; composed: THREE.Group; vertexPreview: THREE.Group; vertexHandles: { dragging: boolean }; update(props: unknown): void; props: unknown };
const viewport = () => (window as unknown as { shipbuilderViewport: LiveViewport }).shipbuilderViewport;
const tick = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

export async function checkVertexVisibility() {
  const checks: string[] = [];
  for (const compiled of [false, true]) {
    const label = compiled ? 'compiled hull' : 'draft hull';
    const catalog = { schemaVersion: 1, revision: 'visibility-fixture', weapons: {}, equipment: [] } as ConstructionCatalog;
    const initial = createStarterSource(catalog, 'blank'); initial.construction.primitives[0].size = [4, 4, 4];
    const result: ConstructionResult | undefined = compiled ? {
      sourceId: initial.id, revision: initial.revision, contentHash: 'fixture', diagnostics: [],
      surfaces: VERTEX_FACES.map(face => {
        const vertices = face.corners.map(i => CORNER_SIGNS[i].map(n => n * 2) as Vec3);
        const a = new THREE.Vector3(...vertices[0]), b = new THREE.Vector3(...vertices[1]), c = new THREE.Vector3(...vertices[2]);
        return { id: `hull:${face.name}`, primitiveId: 'hull', face: face.name, vertices,
          normal: b.sub(a).cross(c.sub(a)).normalize().toArray() as Vec3,
          areaM2: 16, thicknessMm: 16, material: 'steel', paint: 'naval-gray', open: false };
      }),
    } : undefined;
    let commits = 0;
    function Fixture() {
      const [source, setSource] = useState(initial), [corner, setCorner] = useState(0);
      return <main className="shipbuilder"><BuilderViewport source={source} result={result} catalog={catalog}
        selected={new Set(['hull'])} selectedSurfaces={new Set()} view="orbit" display="paint" gridStep={1}
        gesture="none" pickTargets="hull" moveTargets="none" highlightFaces={false} rooms={false} showCenters={false}
        arcs={[]} proposed={[]} tags={[]} coords={() => ''} fitRequest={0} onPick={() => {}} onStroke={() => {}}
        onBoxSelect={() => {}} onErase={() => {}} onMove={() => {}}
        vertex={{ id: 'hull', corner, symmetry: false, axes: [false, false, false], unit: .2, axis: true, snap: false,
          onSelect: setCorner, onCommit: replacements => { commits++; setSource(current => {
            const next = structuredClone(current); replaceVertexPrimitives(next, replacements); next.revision = crypto.randomUUID(); return next;
          }); } }}/></main>;
    }
    delete (window as unknown as { shipbuilderViewport?: LiveViewport }).shipbuilderViewport;
    const host = document.createElement('div'); document.body.replaceChildren(host); const root = createRoot(host); root.render(<Fixture/>);
    const visible = (stage: string, preview = false) => {
      const v = viewport(); let meshes = 0;
      for (const group of [v.hull, v.composed, v.vertexPreview]) if (group.visible) group.traverseVisible(node => { if (node instanceof THREE.Mesh) meshes++; });
      if (!meshes) throw new Error(`${label}: ${stage} hides every hull mesh (dragging=${v.vertexHandles.dragging}, previewMeshes=${v.vertexPreview.children.length})`);
      const hasPreview = v.vertexPreview.visible && v.vertexPreview.children.length > 0;
      if (hasPreview !== preview) throw new Error(`${label}: ${stage} uses the wrong hull representation`);
      if (preview && (v.hull.visible || v.composed.visible)) throw new Error(`${label}: ${stage} draws both the original and deformed hull`);
      checks.push(`${label}: ${stage} stays visible`);
    };
    const begin = (corner: number) => {
      const button = document.querySelectorAll<HTMLButtonElement>('.sb-vertex-handle')[corner], r = button.getBoundingClientRect();
      // Synthetic pointer events cannot acquire trusted capture. Only capture is stubbed.
      const capture = button.setPointerCapture, release = button.releasePointerCapture;
      button.setPointerCapture = button.releasePointerCapture = () => {};
      const send = (type: string, dx = 0, dy = 0) => button.dispatchEvent(new PointerEvent(type, {
        bubbles: true, pointerId: 41, pointerType: 'mouse', button: 0, buttons: type === 'pointerup' ? 0 : 1,
        clientX: r.x + r.width / 2 + dx, clientY: r.y + r.height / 2 + dy,
      }));
      send('pointerdown'); return { send, restore() { button.setPointerCapture = capture; button.releasePointerCapture = release; } };
    };
    try {
      const deadline = performance.now() + 3000;
      while (!viewport()) {
        const error = document.querySelector('[role="alert"]')?.textContent;
        if (error || performance.now() > deadline) throw new Error(error || `${label}: viewport did not mount`);
        await tick();
      }
      await tick(); visible('initial geometry');
      let drag = begin(1); await tick(); visible('press and hold');
      drag.send('pointermove', 2, 1); await tick(); visible('motion below the drag threshold');
      drag.send('pointerup'); drag.restore(); await tick(); visible('release without movement');
      if (commits) throw new Error(`${label}: clicking created a source edit`);
      drag = begin(2); drag.send('pointermove', 40, 10); await tick(); visible('deformed preview', true);
      // Selection/compile/UI updates during a drag must preserve the active preview.
      viewport().update(viewport().props); visible('update during drag', true);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); drag.restore(); await tick(); visible('cancelled drag');
      if (commits) throw new Error(`${label}: cancelling created a source edit`);
      drag = begin(3); drag.send('pointermove', 40, 10); drag.send('pointerup', 40, 10); drag.restore(); await tick(); visible('committed drag');
      if (commits !== 1) throw new Error(`${label}: expected one completed edit, received ${commits}`);
      checks.push(`${label}: hold/cancel keep source unchanged and a completed drag commits once`);
    } finally { root.unmount(); host.remove(); }
  }
  return { passed: true, checks };
}
