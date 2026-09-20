/** Fails when the tracked ts-rs output in src/multiplayer/generated is stale. */
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rustTool } from './toolchain';

const tracked = 'src/multiplayer/generated';
const fresh = await mkdtemp(join(tmpdir(), 'naval-ts-rs-'));
let stale: string[] = [];
let count = 0;
try {
  // .cargo/config.toml sets TS_RS_EXPORT_DIR without `force`, so this value wins.
  const child = Bun.spawn([rustTool('cargo'), 'run', '--locked', '-q', '-p', 'naval-protocol', '--bin', 'export'], {
    env: { ...process.env, TS_RS_EXPORT_DIR: fresh }, stdout: 'inherit', stderr: 'inherit',
  });
  if (await child.exited) throw new Error('The ts-rs export failed.');
  const [expected, actual] = await Promise.all([readdir(fresh), readdir(tracked)]);
  count = expected.length;
  for (const name of expected) {
    if (!actual.includes(name)) stale.push(`${name} (missing)`);
    else if (await Bun.file(join(fresh, name)).text() !== await Bun.file(join(tracked, name)).text()) stale.push(`${name} (differs)`);
  }
  for (const name of actual) if (!expected.includes(name)) stale.push(`${name} (no longer exported)`);
} finally {
  await rm(fresh, { recursive: true, force: true });
}
if (stale.length) {
  console.error(`${tracked} is stale:\n  ${stale.join('\n  ')}\nRun \`bun run multiplayer:types\`, delete files that are no longer exported, and commit the result.`);
  process.exit(1);
}
console.log(`${tracked}: ${count} generated types are current.`);
