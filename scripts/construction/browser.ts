import type { Server } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import type { ReviewInput } from '../../tools/construction/review';
import { constructionFiles } from './server';

/** Supplies review input JSON per request URL; a warm session serves one input per lease. */
export type ReviewInputSource = (url: URL) => string | undefined;
export const CHROMIUM_LAUNCH = () => ({ headless: true, args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'], ...(process.env.CONSTRUCTION_CHROME ? { executablePath: process.env.CONSTRUCTION_CHROME } : {}) });
export async function authoringServer(root: string, port = 0, game = false, reviewInput?: ReviewInput | ReviewInputSource, repositoryRoot = root): Promise<ViteDevServer> {
  // Vite treats zero as its default port. Reserve an OS-selected port instead
  // of entering its port-increment retry path when another local app is open.
  if (!port) {
    const probe = createTcpServer();
    await new Promise<void>((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
    const address = probe.address();
    if (!address || typeof address === 'string') throw new Error('Could not allocate a review port.');
    port = address.port;
    await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  }
  // Large native definitions must travel as JSON bytes. Playwright's recursive
  // argument encoding otherwise multiplies their memory use before Chromium
  // receives the model.
  const fixedJson = reviewInput && typeof reviewInput !== 'function' ? JSON.stringify(reviewInput) : undefined;
  const inputFor: ReviewInputSource = typeof reviewInput === 'function' ? reviewInput : () => fixedJson;
  const server = await createServer({
    root, configFile: game ? join(root, 'vite.config.ts') : false,
    // Review servers may coexist with the editor or another asset build. Their
    // different entry graphs must not invalidate each other's optimized modules.
    cacheDir: join(root, '.build/construction/vite-cache', String(port)),
    logLevel: 'error', plugins: game ? [] : [react(), constructionFiles(repositoryRoot), {
      name: 'construction-review-input',
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          const url = new URL(request.url ?? '/', 'http://127.0.0.1');
          const inputJson = url.pathname === '/__review_input.json' ? inputFor(url) : undefined;
          if (!inputJson) return next();
          response.setHeader('Content-Type', 'application/json');
          response.setHeader('Cache-Control', 'no-store');
          response.end(inputJson);
        });
      },
    }],
    resolve: { dedupe: ['three'] }, worker: { format: 'es' },
    // A fixed-input asset review must survive unrelated editor/test saves.
    // Only scan live entries, rather than retired diagnostic HTML imports.
    optimizeDeps: { entries: game ? ['index.html'] : ['tools/construction/review.html', 'tools/construction/editor.html'] },
    server: { host: '127.0.0.1', port, strictPort: true, ...(game ? {} : { hmr: false }) },
  });
  await server.listen(); return server;
}
export const serverUrl = (server: ViteDevServer) => {
  const address = server.httpServer!.address();
  if (!address || typeof address === 'string') throw new Error('Authoring server has no TCP address.');
  return 'http://127.0.0.1:' + address.port;
};
const debug = (message: string) => { if (process.env.CONSTRUCTION_DEBUG) console.error(message); };
/** A 1600×1000 page with the review model of the input at `inputPath` composed. The cold path and the session daemon share it. */
export async function openReviewPage(owner: Browser | BrowserContext, origin: string, inputPath: string): Promise<Page> {
  const page = 'newContext' in owner ? await owner.newPage({ viewport: { width: 1600, height: 1000 } }) : await owner.newPage();
  page.setDefaultTimeout(120_000);
  const errors: string[] = []; page.on('pageerror', e => { errors.push(e.message); debug(e.message); });
  page.on('requestfailed', request => debug(request.url() + ': ' + request.failure()?.errorText));
  debug('Loading review page');
  await page.goto(origin + '/tools/construction/review.html', { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForFunction(() => !!window.constructionReviewModule, undefined, { timeout: 120_000 }).catch(error => { throw new Error(errors.join('\n') || error.message); });
  debug('Composing review model');
  await page.evaluate(async path => {
    const response = await fetch(path);
    if (!response.ok) throw new Error('Could not load construction review input.');
    window.constructionReviewInput = await response.json();
    window.constructionReview = await window.constructionReviewModule!.openReview(window.constructionReviewInput!);
  }, inputPath);
  return page;
}
/** Runs `work` on a page holding the composed review model. A live warm session lends its Chromium and review server
 * (fresh context per call, one call at a time; `page` then forwards `evaluate` only); anything else launches both for this call. */
export async function withConstructionBrowser<T>(root: string, input: ReviewInput, work: (page: Page) => Promise<T>): Promise<T> {
  if (process.env.CONSTRUCTION_SESSION !== 'off' && existsSync(join(root, '.build/construction/session.json'))) {
    const lease = await (await import('./session')).sessionBrowser(root, JSON.stringify(input));
    if (lease) try { debug('Running review operation in the session'); return await work(lease.page); } finally { await lease.release(); }
  }
  debug('Starting construction renderer');
  const server = await authoringServer(root, 0, false, input);
  let browser;
  try {
    debug('Launching Chromium');
    browser = await chromium.launch(CHROMIUM_LAUNCH());
    const page = await openReviewPage(browser, serverUrl(server), '/__review_input.json');
    debug('Running review operation');
    return await work(page);
  } finally { debug('Closing Chromium'); await browser?.close(); debug('Closing Vite'); (server.httpServer as Server | null)?.closeAllConnections(); await server.close(); debug('Renderer closed'); }
}
