import { expect, test } from 'bun:test';
import { cachedConstructionCompile, COMPILE_CACHE_ENTRIES } from './constructionCompileCache';

function storage() {
  const entries = new Map<string, Response>();
  const cache = {
    match: async (key: string) => entries.get(key)?.clone(),
    put: async (key: string, value: Response) => { entries.set(key, value.clone()); },
    keys: async () => [...entries.keys()].map(key => new Request(key)),
    delete: async (key: Request) => entries.delete(key.url),
  } as unknown as Cache;
  return { entries, open: async () => cache };
}

test('a fresh compiler reuses exact output after the previous worker is discarded', async () => {
  const disk = storage(); let calls = 0;
  const run = () => cachedConstructionCompile('build', 'source', 'catalog', () => { calls++; return '{"sourceId":"ship","surfaces":[]}'; }, disk);
  const first = await run();
  expect(await run()).toBe(first);
  expect(calls).toBe(1);
});

test('source bytes, catalog bytes and compiler build each invalidate the result', async () => {
  const disk = storage(); let calls = 0;
  for (const [build, source, catalog] of [['a','b','c'], ['a','changed','c'], ['a','b','changed'], ['changed','b','c']]) {
    expect(await cachedConstructionCompile(build, source, catalog, () => String(++calls), disk)).toBe(String(calls));
  }
  expect(calls).toBe(4);
});

test('old entries are evicted so edits and compiler releases cannot grow storage indefinitely', async () => {
  const disk = storage();
  for (let i = 0; i < COMPILE_CACHE_ENTRIES + 2; i++) await cachedConstructionCompile('build', String(i), 'catalog', () => '{}', disk);
  expect(disk.entries.size).toBe(COMPILE_CACHE_ENTRIES);
  let compiled = false;
  await cachedConstructionCompile('build', '0', 'catalog', () => { compiled = true; return '{}'; }, disk);
  expect(compiled).toBe(true);
});

test('blocked storage and failed cache writes still return the compiler output once', async () => {
  let calls = 0;
  const denied = { open: async () => { throw new Error('Storage denied'); } };
  expect(await cachedConstructionCompile('a','b','c', () => { calls++; return '{}'; }, denied)).toBe('{}');
  const disk = storage(), cache = await disk.open(); cache.put = async () => { throw new Error('Quota exceeded'); };
  expect(await cachedConstructionCompile('a','b','c', () => { calls++; return '{}'; }, disk)).toBe('{}');
  expect(calls).toBe(2);
});

test('compiler failures are not cached or retried by the cache', async () => {
  const disk = storage(); let calls = 0;
  await expect(cachedConstructionCompile('a','b','c', () => { calls++; throw new Error('Compile failed'); }, disk)).rejects.toThrow('Compile failed');
  expect(calls).toBe(1); expect(disk.entries.size).toBe(0);
});

test('an unreadable cache entry is repaired by compilation', async () => {
  const disk = storage();
  await cachedConstructionCompile('a','b','c', () => '{}', disk);
  const key = [...disk.entries.keys()][0];
  disk.entries.set(key, new Response('truncated {'));
  let calls = 0;
  expect(await cachedConstructionCompile('a','b','c', () => { calls++; return '{"repaired":true}'; }, disk)).toBe('{"repaired":true}');
  expect(calls).toBe(1);
});

test('large results are stored compressed and read back byte-for-byte', async () => {
  const disk = storage(); let calls = 0;
  const output = JSON.stringify({ vertices: Array.from({ length: 10000 }, () => [1.23456789, -0.25, 100]) });
  const run = () => cachedConstructionCompile('build', 'source', 'catalog', () => { calls++; return output; }, disk);
  expect(await run()).toBe(output);
  const response = [...disk.entries.values()][0];
  expect(response.headers.get('X-Construction-Compression')).toBe('gzip');
  expect((await response.clone().arrayBuffer()).byteLength).toBeLessThan(output.length / 4);
  expect(await run()).toBe(output);
  expect(calls).toBe(1);
});

test('damaged compressed entries fall back to compilation and are replaced', async () => {
  const disk = storage();
  await cachedConstructionCompile('build', 'source', 'catalog', () => '{}', disk);
  const key = [...disk.entries.keys()][0];
  disk.entries.set(key, new Response('bad gzip', { headers: { 'X-Construction-Compression': 'gzip' } }));
  let calls = 0;
  expect(await cachedConstructionCompile('build', 'source', 'catalog', () => { calls++; return '{"repaired":true}'; }, disk)).toBe('{"repaired":true}');
  expect(calls).toBe(1);
  expect(disk.entries.get(key)!.headers.get('X-Construction-Compression')).toBeNull();
});
