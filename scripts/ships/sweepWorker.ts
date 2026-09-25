/** A `ship:sweep` interlock replay worker (see sweepInterlock.ts): loads the definition into one WASM
 * `ArticulationPreview`, answers the queries sweep.ts hands it and returns the cache entries it computed;
 * sweep.ts seeds every worker with each round's entries. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createReplay, type Definition, type Query, type ReplayCache } from './sweepInterlock';

declare const self: Worker;
export type WorkerRequest =
  | { type: 'init'; definitionPath: string }
  | { type: 'seed'; cache: ReplayCache }
  | { type: 'answer'; id: number; queries: Query[] };

const root = join(import.meta.dir, '../..');
let replay: ReturnType<typeof createReplay> | undefined;

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (message.type === 'init') {
    const text = readFileSync(message.definitionPath, 'utf8');
    const wasm = await import('../../src/generated/naval-wasm/naval_wasm');
    await wasm.default({ module_or_path: readFileSync(join(root, 'src/generated/naval-wasm/naval_wasm_bg.wasm')) });
    const preview = new wasm.ArticulationPreview(text);
    replay = createReplay(JSON.parse(text) as Definition, (current, requested) => JSON.parse(preview.resolve(JSON.stringify(current), JSON.stringify(requested))));
    self.postMessage({ ready: true });
  } else if (message.type === 'seed') replay!.seed(message.cache);
  else if (message.type === 'answer') {
    for (const q of message.queries) replay!.answer(q);
    self.postMessage({ id: message.id, cache: replay!.drain() });
  }
};
