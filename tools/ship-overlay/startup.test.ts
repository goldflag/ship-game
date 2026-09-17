import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { env } from 'node:process';

test('the model:viewer command starts and serves the ship catalog', async () => {
  // Vite treats --port 0 as its default port; reserve an available test port instead.
  const reservation = createServer();
  await new Promise<void>((resolve, reject) => {
    reservation.once('error', reject);
    reservation.listen(0, '127.0.0.1', resolve);
  });
  const address = reservation.address();
  if (!address || typeof address === 'string') throw new Error('Missing test port');
  await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  const process = Bun.spawn([Bun.which('bun')!, 'run', 'model:viewer', '--port', String(address.port), '--clearScreen', 'false'], {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    stdout: 'pipe', stderr: 'pipe',
    env: { ...env, NO_COLOR: '1' },
  });
  const errors = new Response(process.stderr).text();
  let output = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const url = await Promise.race([
      (async () => {
        const reader = process.stdout.getReader();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          output += new TextDecoder().decode(value);
          const match = output.match(/Local:\s+(http:\/\/127\.0\.0\.1:\d+\/)/);
          if (match) return match[1];
        }
        throw new Error('Viewer stopped before startup: ' + output + await errors);
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Viewer startup timed out: ' + output)), 15000);
      }),
    ]);
    const response = await fetch(url + 'api/ships');
    expect(response.status).toBe(200);
    const ships = await response.json() as { id: string; modelUrl: string }[];
    expect(ships.length).toBeGreaterThan(0);
    expect(ships.some(ship => ship.id === 'bismarck')).toBe(true);
    expect(ships.every(ship => ship.modelUrl.endsWith('.glb'))).toBe(true);
  } finally {
    clearTimeout(timer);
    process.kill();
    await process.exited;
    await errors;
  }
}, 20000);
