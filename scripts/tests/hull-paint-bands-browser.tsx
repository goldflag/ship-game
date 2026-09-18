import React from 'react';
import { createRoot } from 'react-dom/client';
import * as THREE from 'three/webgpu';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import CustomHullEditor from '../../src/ui/shipbuilding/CustomHullEditor';
import { createStarterSource } from '../../src/ships/constructionStarter';
import { customHullPrimitive, editableCustomHull, hullExtent, type Hull } from '../../src/ships/customHullModel';
import { decodeConstructionSource } from '../../src/ships/constructionEditor';
import { loadConstructionCatalog } from '../../src/ships/constructionEquipment';
import { createConstructionModel, disposeConstructionModel } from '../../src/game/constructionModel';
import { hullPaintBands } from '../../src/ships/hullPaintBands';
import type { ConstructionResult } from '../../src/ships/blueprint';
import init, { compile_construction } from '../../src/generated/naval-wasm/naval_wasm';
import '@fontsource/barlow/latin-400.css';
import '@fontsource/barlow/latin-500.css';
import '@fontsource/barlow-condensed/latin-500.css';
import '../../src/ui/styles.css';

/** Disposable editor source: never reads or writes the player's saved library. */
export async function mountHullPaintBandsReview() {
  await init();
  const catalog = await loadConstructionCatalog();
  let source = createStarterSource(catalog, 'fletcher-hull', 'sea-blue');
  source.construction.surfaces.push({ primitiveId: 'hull', face: 'bottom', thicknessMm: 25, material: 'armor-steel', paint: 'red-oxide' });
  const root = createRoot(document.body.appendChild(document.createElement('div')));
  const compile = (): ConstructionResult => JSON.parse(compile_construction(JSON.stringify(source), JSON.stringify(catalog)));
  const initial = compile();
  if (!initial.definition) throw new Error(JSON.stringify(initial.diagnostics));
  const close = () => root.render(null);
  const open = () => root.render(<CustomHullEditor integration={{ hull: editableCustomHull(source.construction.primitives[0]), appearance: source.construction, designName: 'Paint bands review',
    measure: async () => ({ waterline: initial.loading!.waterlineY, draft: initial.loading!.waterlineY - hullExtent(editableCustomHull(source.construction.primitives[0])).base, displacementTonnes: initial.loading!.massKg / 1000 }),
    onApply: (hull: Hull) => {
      source.construction.primitives[0] = customHullPrimitive(hull, source.construction.primitives[0]);
      source.revision = crypto.randomUUID(); source = decodeConstructionSource(JSON.parse(JSON.stringify(source))); close();
    }, onClose: close,
  }} />);
  const exported = async () => {
    const result = compile();
    if (!result.definition) throw new Error(JSON.stringify(result.diagnostics));
    const model = await createConstructionModel(source, result);
    try {
      const bytes = await new GLTFExporter().parseAsync(model, { binary: true }) as ArrayBuffer;
      const loaded = (await new GLTFLoader().parseAsync(bytes, '')).scene;
      const bands = hullPaintBands(source.construction.primitives[0].customHull);
      let checked = 0, invalid = 0;
      loaded.traverse(node => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        const material = mesh.material as THREE.Material;
        if (!material.name.startsWith('construction.')) return;
        const paint = material.name.slice('construction.'.length).split(':')[0];
        const p = mesh.geometry.getAttribute('position');
        for (let i = 0; i < p.count; i += 3) {
          const y = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
          const band = bands.find(b => y < b.upperY - 1e-6);
          if (band && band.paint !== paint) invalid++;
          if (!band && !['sea-blue', 'deck-gray'].includes(paint)) invalid++;
          checked++;
        }
      });
      disposeConstructionModel(loaded);
      if (!checked || invalid) throw new Error(`Exported band mismatch: ${invalid}/${checked}`);
      return { bytes: bytes.byteLength, triangles: checked, bands: bands.length };
    } finally { disposeConstructionModel(model); }
  };
  const review = { open, source: () => structuredClone(source), exported };
  Object.assign(window, { hullPaintReview: review }); open();
  return true;
}
