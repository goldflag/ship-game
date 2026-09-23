import { expect, test } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { blenderVersion, runBlender } from '../build/blender';

// The shared launcher's audited path, which the ship pipeline and the construction front end use.
const root = resolve(import.meta.dir, '../..');
const scratch = join(root, '.build/construction-blender/launcher-test');
const blender = blenderVersion();

test.skipIf(!blender)('an audited run records reads, runs the prelude and epilogue, and refuses published models', async () => {
  await rm(scratch, { recursive: true, force: true });
  await mkdir(scratch, { recursive: true });
  const input = join(scratch, 'input.txt'),
    script = join(scratch, 'script.py'),
    reads = join(scratch, 'reads.json');
  await writeFile(input, 'hello');
  await writeFile(script, `import os\nopen(os.environ['INPUT']).read()\nprint('SCRIPT_RAN', PRELUDE_VALUE)\n`);
  const run = await runBlender(script, { INPUT: input }, {
    cwd: root,
    audit: { root, readsFile: reads, forbid: 'published' },
    prelude: 'import builtins\nbuiltins.PRELUDE_VALUE = 7\n',
    epilogue: "print('EPILOGUE_RAN')\n",
  });
  expect(run.stdout).toContain('SCRIPT_RAN 7');
  expect(run.stdout).toContain('EPILOGUE_RAN');
  expect(JSON.parse(await readFile(reads, 'utf8'))).toContain('.build/construction-blender/launcher-test/input.txt');

  await writeFile(script, `open(${JSON.stringify(join(root, 'public/models/components/catalog.json'))}).read()\n`);
  await expect(runBlender(script, {}, { cwd: root, audit: { root, forbid: 'published' } })).rejects.toThrow('forbidden in original authoring');
  // The ship pipeline's narrower rule still lets a recipe read published data.
  await runBlender(script, {}, { cwd: root, audit: { root, forbid: 'reference' } });
  await rm(scratch, { recursive: true, force: true });
}, 120_000);
