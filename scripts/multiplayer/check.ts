import { homedir } from 'node:os';
import { join } from 'node:path';
const cargo = join(homedir(), '.cargo', 'bin', 'cargo');
for (const command of [[process.execPath, 'scripts/multiplayer/content.ts'], [cargo, 'test', '--workspace', '--locked'], [cargo, 'clippy', '--workspace', '--all-targets', '--locked', '--', '-D', 'warnings'], [process.execPath, 'scripts/multiplayer/build-wasm.ts'], [process.execPath, 'scripts/multiplayer/check-wasm.ts']]) {
  const child = Bun.spawn(command, { stdout: 'inherit', stderr: 'inherit' });
  const code = await child.exited;
  if (code) process.exit(code);
}
