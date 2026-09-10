import { rustTool } from './toolchain';
const cargo = rustTool('cargo');
// Full carrier scenarios are numerical simulation workloads. Test the optimized
// production profile so CI can run every case within its execution budget.
for (const command of [[process.execPath, 'scripts/multiplayer/content.ts'], [cargo, 'test', '--release', '--workspace', '--locked'], [cargo, 'clippy', '--workspace', '--all-targets', '--locked', '--', '-D', 'warnings'], [process.execPath, 'scripts/multiplayer/build-wasm.ts'], [process.execPath, 'scripts/multiplayer/check-wasm.ts']]) {
  const child = Bun.spawn(command, { stdout: 'inherit', stderr: 'inherit' });
  const code = await child.exited;
  if (code) process.exit(code);
}
