import type { Server } from 'node:http';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium, type Page } from 'playwright';
import { join } from 'node:path';
import type { ReviewInput } from '../../tools/construction/review';
import { constructionFiles } from './server';

export async function authoringServer(root: string, port = 0, game = false): Promise<ViteDevServer> {
  const server = await createServer({
    root, configFile: game ? join(root, 'vite.config.ts') : false,
    logLevel: 'error', plugins: game ? [] : [react(), constructionFiles(root)],
    resolve: { dedupe: ['three'] }, worker: { format: 'es' },
    server: { host: '127.0.0.1', port, strictPort: !!port },
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
  const server = await authoringServer(root);
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
    await page.evaluate(async value => { window.constructionReview = await window.constructionReviewModule!.openReview(value); }, input);
    debug('Running review operation');
    return await work(page);
  } finally { debug('Closing Chromium'); await browser?.close(); debug('Closing Vite'); (server.httpServer as Server | null)?.closeAllConnections(); await server.close(); debug('Renderer closed'); }
}
