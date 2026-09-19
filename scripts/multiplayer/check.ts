import { rustTool } from './toolchain';
const cargo = rustTool('cargo');
const bun = process.execPath;
// Full carrier scenarios are numerical simulation workloads. Test the optimized
// production profile so CI can run every case within its execution budget.
const commands = [
  [bun, 'scripts/multiplayer/content.ts'],
  // Generated sources first: a stale definition.rs or ts-rs output explains later failures.
  [bun, 'test', 'scripts/multiplayer/generate-rust-definitions.test.ts'],
  [bun, 'scripts/multiplayer/check-generated-types.ts'],
  [cargo, 'test', '--release', '--workspace', '--locked'],
  [cargo, 'clippy', '--workspace', '--all-targets', '--locked', '--', '-D', 'warnings'],
  [bun, 'scripts/multiplayer/build-wasm.ts'],
];
for (const command of commands) {
  const child = Bun.spawn(command, { stdout: 'inherit', stderr: 'inherit' });
  const code = await child.exited;
  if (code) process.exit(code);
}
