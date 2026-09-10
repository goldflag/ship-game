import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import type { Plugin } from 'vite';

/** Every GLB under the models tree, as paths relative to it. */
function models(directory: string, prefix = ''): string[] {
  return readdirSync(`${directory}/${prefix}`, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? models(directory, `${prefix}${entry.name}/`)
      : entry.name.endsWith('.glb') ? [`${prefix}${entry.name}`] : []);
}

/** Lossless transport copies only. Authoring GLBs and their validation hashes remain
 * untouched in public/; static hosts need no Content-Encoding configuration. The build
 * publishes only the compressed copy, because that is the only one the game asks for. */
export function shipTransfers(modelsDirectory: string): Plugin {
  const names = new Set<string>();
  let outputDirectory = 'dist';
  return {
    name: 'compressed-ship-transfers',
    apply: 'build',
    configResolved(config) { outputDirectory = config.build.outDir; },
    generateBundle() {
      names.clear();
      // Aircraft live in subdirectories and were missed while this listing was flat.
      for (const name of models(modelsDirectory)) {
        names.add(name);
        this.emitFile({
          type: 'asset', fileName: `models/${name}.gz`,
          source: gzipSync(readFileSync(`${modelsDirectory}/${name}`), { level: 6 }),
        });
      }
    },
    closeBundle() {
      // public/ is copied verbatim, so the uncompressed original lands beside the transfer
      // copy and doubles the deployed tree for bytes nothing ever requests.
      for (const name of names) rmSync(`${outputDirectory}/models/${name}`, { force: true });
    },
  };
}
