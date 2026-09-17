/** Browser regression for failed startup admission, integrity rejection and retry. */
import { chromium } from 'playwright';
import { authoringServer, serverUrl } from '../construction/browser';
import { mkdir } from 'node:fs/promises';
const directory = '.build/runtime-startup';
await mkdir(directory, { recursive: true });
const server = await authoringServer(process.cwd(), 0, true);
const browser = await chromium.launch({ headless: false,
  ...(process.env.CONSTRUCTION_CHROME ? { executablePath: process.env.CONSTRUCTION_CHROME } : {}),
});
const results: unknown[] = [];
try {
  for (const failure of ['network', 'digest'] as const) {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const now = new Date().toISOString();
    await context.route('**/api/auth/get-session', route => route.fulfill({ json: {
      session: { id: 'runtime-test', userId: 'runtime-test', token: 'test', expiresAt: new Date(Date.now() + 3600000).toISOString(), createdAt: now, updatedAt: now },
      user: { id: 'runtime-test', name: 'Runtime test', email: 'runtime@example.test', emailVerified: true, createdAt: now, updatedAt: now },
    } }));
    await context.route('**/api/ships**', route => route.fulfill({ json: [] }));
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    let requests = 0;
    page.on('request', request => { if (request.url().endsWith('/resolute.nsd')) requests++; });
    const route = '**/models/runtime/resolute.nsd';
    await context.route(route, request => failure === 'network' ? request.abort() : request.fulfill({ contentType: 'application/octet-stream', body: Buffer.from('invalid digest') }));
    try {
      await page.goto(serverUrl(server) + '/?ship=resolute');
      await page.getByRole('alert').filter({ hasText: 'Unable to load the selected ship' }).waitFor({ timeout: 60000 });
      const rejectedEarlyGeometry = await page.evaluate(async () => {
        const { selectedShip } = await import('/src/ships/presets.ts' as string);
        try { void selectedShip.compartments; return false; } catch { return true; }
      });
      if (!rejectedEarlyGeometry) throw Error('Unloaded geometry must fail closed');
      await page.screenshot({ path: `${directory}/${failure}-error.png` });
      const failedRequests = requests;
      await context.unroute(route);
      await page.getByRole('button', { name: 'Retry loading ship' }).click();
      await page.getByRole('button', { name: 'Statistics', exact: true }).waitFor({ timeout: 180000 });
      await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent?.trim() === 'Statistics' && !button.disabled), undefined, { timeout: 180000 });
      if (requests <= failedRequests) throw Error('Retry did not fetch a fresh definition');
      if (errors.length) throw Error(errors.join('\n'));
      // Ready UI can precede the first expensive WebGPU pipeline compilation.
      await page.waitForTimeout(10000);
      await page.screenshot({ path: `${directory}/${failure}-recovered.png` });
      results.push({ failure, failedRequests, requests, recovered: true, rejectedEarlyGeometry, pageErrors: errors });
      await Bun.write(`${directory}/results.json`, JSON.stringify(results, null, 2));
    } catch (error) {
      await Bun.write(`${directory}/failure.json`, JSON.stringify({ failure, requests, errors, error: String(error), text: await page.locator('body').innerText() }, null, 2));
      throw error;
    } finally { await context.close(); }
  }
} finally { await browser.close(); await server.close(); }
console.log(results);
