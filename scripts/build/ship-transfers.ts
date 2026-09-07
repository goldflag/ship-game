import { readFileSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import type { Plugin } from 'vite';

/** Lossless transport copies only. Authoring GLBs and their validation hashes
 * remain untouched; static hosts need no Content-Encoding configuration. */
export function shipTransfers(modelsDirectory: string): Plugin {
  return {
    name: 'compressed-ship-transfers',
    apply: 'build',
    generateBundle() {
      for (const name of readdirSync(modelsDirectory)) {
        if (!name.endsWith('.glb')) continue;
        this.emitFile({
          type: 'asset', fileName: `models/${name}.gz`,
          source: gzipSync(readFileSync(`${modelsDirectory}/${name}`), { level: 6 }),
        });
      }
    },
  };
}
