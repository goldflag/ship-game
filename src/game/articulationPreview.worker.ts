import init, { preview_articulation_json } from '../generated/naval-wasm/naval_wasm';
import type { ShipDefinition } from '../ships/blueprint';
import type { ClearancePose } from './articulationPreview';

const ready = init();
let chain = Promise.resolve();
self.onmessage = ({ data }: MessageEvent<{ id: number; definition: ShipDefinition; current: ClearancePose[]; requested: ClearancePose[] }>) => {
  chain = chain.then(async () => {
    try {
      await ready;
      const results = JSON.parse(preview_articulation_json(JSON.stringify(data.definition), JSON.stringify(data.current), JSON.stringify(data.requested)));
      self.postMessage({ id: data.id, results });
    } catch (error) {
      self.postMessage({ id: data.id, error: String(error) });
    }
  });
};
