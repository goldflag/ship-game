import type { Server } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium, type Page } from 'playwright';
import { join } from 'node:path';
import type { ReviewInput } from '../../tools/construction/review';
import { constructionFiles } from './server';

export async function authoringServer(root: string, port = 0, game = false, reviewInput?: ReviewInput): Promise<ViteDevServer> {
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
  const inputJson = reviewInput ? JSON.stringify(reviewInput) : undefined;
  const server = await createServer({
    root, configFile: game ? join(root, 'vite.config.ts') : false,
    logLevel: 'error', plugins: game ? [] : [react(), constructionFiles(root), {
      name: 'construction-review-input',
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (request.url !== '/__review_input.json' || !inputJson) return next();
          response.setHeader('Content-Type', 'application/json');
          response.setHeader('Cache-Control', 'no-store');
          response.end(inputJson);
        });
      },
    }],
    resolve: { dedupe: ['three'] }, worker: { format: 'es' },
    server: { host: '127.0.0.1', port, strictPort: true },
  });
  await server.listen(); return server;
}
export const serverUrl = (server: ViteDevServer) => {
  const address = server.httpServer!.address();
  if (!address || typeof address === 'string') throw new Error('Authoring server has no TCP address.');
  return 'http://127.0.0.1:' + address.port;
};
export async function withConstructionBrowser<T>(root: string, input: ReviewInput, work: (page: Page) => Promise<T>): Promise<T> {
  const debug = (message: string) => { if (process.env.CONSTRUCTION_DEBUG) console.error(message); };
  debug('Starting construction renderer');
  const server = await authoringServer(root, 0, false, input);
  let browser;
  try {
    debug('Launching Chromium');
    browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'], ...(process.env.CONSTRUCTION_CHROME ? { executablePath: process.env.CONSTRUCTION_CHROME } : {}) });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    page.setDefaultTimeout(120_000);
    const errors: string[] = []; page.on('pageerror', e => { errors.push(e.message); debug(e.message); });
    page.on('requestfailed', request => debug(request.url() + ': ' + request.failure()?.errorText));
    debug('Loading review page');
    await page.goto(serverUrl(server) + '/tools/construction/review.html', { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.waitForFunction(() => !!window.constructionReviewModule, undefined, { timeout: 120_000 }).catch(error => { throw new Error(errors.join('\n') || error.message); });
    debug('Composing review model');
    await page.evaluate(async () => {
      const response = await fetch('/__review_input.json');
      if (!response.ok) throw new Error('Could not load construction review input.');
      window.constructionReviewInput = await response.json();
      window.constructionReview = await window.constructionReviewModule!.openReview(window.constructionReviewInput!);
    });
    debug('Running review operation');
    return await work(page);
  } finally { debug('Closing Chromium'); await browser?.close(); debug('Closing Vite'); (server.httpServer as Server | null)?.closeAllConnections(); await server.close(); debug('Renderer closed'); }
}
