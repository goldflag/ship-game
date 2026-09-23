/** Whether this checkout was bootstrapped. It imports nothing from node_modules, so it runs before dependencies exist and
 * turns a fresh worktree's "Cannot find module 'three/webgpu'" into the command that fixes it. */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** `wasm`: the caller also needs the prepared simulation (dev WASM and content manifest) that tests load. */
export function bootstrapGaps(root: string, needs: { wasm?: boolean } = {}): { install: string[]; prepare: string[] } {
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const packages = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
  return {
    install: packages.filter(name => !existsSync(resolve(root, 'node_modules', name, 'package.json'))),
    prepare: needs.wasm ? ['src/generated/naval-wasm/naval_wasm_bg.wasm', '.build/naval-content/manifest.json'].filter(file => !existsSync(resolve(root, file))) : [],
  };
}

export function requireBootstrapped(root: string, needs: { wasm?: boolean } = {}) {
  const { install, prepare } = bootstrapGaps(root, needs);
  if (install.length) {
    const named = `${install.slice(0, 4).join(', ')}${install.length > 4 ? ` and ${install.length - 4} more` : ''}`;
    console.error(`Worktree not bootstrapped: node_modules lacks ${named}. Run bun run bootstrap (install, simulation content and dev WASM).`);
    process.exit(1);
  }
  if (prepare.length) {
    console.error(`Worktree not prepared: ${prepare.join(' and ')} missing. Run bun run multiplayer:prepare:dev (bun run bootstrap also does it).`);
    process.exit(1);
  }
}
