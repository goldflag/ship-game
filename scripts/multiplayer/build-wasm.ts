import { rustTool } from './toolchain';
async function run(command: string[]) {
  const process = Bun.spawn(command, { stdout: 'inherit', stderr: 'inherit' });
  if (await process.exited) throw new Error(`Failed: ${command[0]}`);
}
await run([rustTool('cargo'), 'build', '-p', 'naval-wasm', '--target', 'wasm32-unknown-unknown', '--release', '--locked']);
await run([rustTool('wasm-bindgen'), '--target', 'web', '--out-dir', 'src/generated/naval-wasm', 'target/wasm32-unknown-unknown/release/naval_wasm.wasm']);
// Embed the exact local content/build identity; never adopt the server's version
// as our own, which would silently accept a stale browser deployment.
const { default: init, simulation_build, protocol_version } = await import('../../src/generated/naval-wasm/naval_wasm.js');
await init({ module_or_path: await Bun.file('src/generated/naval-wasm/naval_wasm_bg.wasm').arrayBuffer() });
const manifest = await Bun.file('.build/naval-content/manifest.json').arrayBuffer();
const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', manifest)), n => n.toString(16).padStart(2, '0')).join('');
await Bun.write('src/generated/naval-version.json', JSON.stringify({ protocol: protocol_version(), simulationBuild: simulation_build(), manifestHash: hash, rulesVersion: (await Bun.file('assets/gameplay/battle-rules.v1.json').json()).version }));
