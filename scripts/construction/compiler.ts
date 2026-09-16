import { join } from 'node:path';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import type { ConstructionResult, ConstructionSource } from '../../src/ships/blueprint';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { readCatalog } from './files';

/** The same Rust entry point used to verify browser/WASM compilation. */
export async function compileConstruction(root: string, source: ConstructionSource): Promise<ConstructionResult> {
  const catalog = await readCatalog(root, source.construction.catalogRevision);
  const directory = join(root, '.build/construction/compile', crypto.randomUUID());
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(join(directory, 'source.json'), JSON.stringify(source));
    await writeFile(join(directory, 'catalog.json'), JSON.stringify(catalog));
    const localCargo = join(homedir(), '.cargo/bin', process.platform === 'win32' ? 'cargo.exe' : 'cargo');
    const child = spawn(existsSync(localCargo) ? localCargo : 'cargo', ['run', '--quiet', '--locked', '--profile', 'wasm-dev', '-p', 'naval-sim', '--example', 'compile_construction', '--', join(directory, 'source.json'), join(directory, 'catalog.json')], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 600_000);
    try {
      let stdout = '', stderr = '';
      child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
      const code = await new Promise<number | null>((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
      if (timedOut) throw new Error('Native construction compile exceeded ten minutes. Simplify the source before retrying.');
      if (code !== 0) throw new Error('Native construction compile failed: ' + stderr.slice(-4000));
      return JSON.parse(stdout);
    } finally { clearTimeout(timer); }
  } finally { await rm(directory, { recursive: true, force: true }); }
}
