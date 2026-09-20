/** Playwright driver for the account-free harness page (`scripts/diagnostics/app.html`).
 *
 * One place for what every UI verification otherwise rediscovers: WebGPU needs a headed Chromium,
 * a free strict port per run, screenshots through CDP (`page.screenshot()` blurs a headed window and
 * cancels drags, ghosts and tooltips), and a battle reached through the real dialog.
 * See `docs/browser-verification.md`. */
import type { Server } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { authoringServer, serverUrl } from '../construction/browser';
import type {} from '../diagnostics/app';

export const ROOT = resolve(import.meta.dir, '../..');
export const HARNESS_PAGE = '/scripts/diagnostics/app.html';

export interface HarnessOptions {
  /** Query parameters for the harness page, e.g. `{ battle: 'fletcher;;bismarck', range: 8000 }`. */
  params?: Record<string, string | number>;
  /** Bill's display; representative for port, editor and HUD captures. */
  viewport?: { width: number; height: number };
  /** Headless Chromium reaches the port but its WebGPU frame loop stalls, so headed is the default. */
  headless?: boolean;
  /** Reuse a running dev server (`http://127.0.0.1:5200`) instead of starting one on a free port. */
  url?: string;
  timeout?: number;
}
export interface Harness { page: Page; browser: Browser; url: string; errors: string[]; close(): Promise<void>; }

export async function launchHarness(options: HarnessOptions = {}): Promise<Harness> {
  const server = options.url ? undefined : await authoringServer(ROOT, 0, true);
  const url = options.url ?? serverUrl(server!), viewport = options.viewport ?? { width: 1728, height: 1030 };
  let browser: Browser | undefined;
  const close = async () => { await browser?.close().catch(() => undefined); (server?.httpServer as Server | null)?.closeAllConnections(); await server?.close(); };
  try {
    browser = await chromium.launch({ headless: options.headless ?? false, args: ['--enable-unsafe-webgpu', '--window-position=0,0', `--window-size=${viewport.width},${viewport.height + 90}`],
      ...(process.env.HARNESS_CHROME ? { executablePath: process.env.HARNESS_CHROME } : {}) });
    const page = await browser.newPage({ viewport });
    page.setDefaultTimeout(options.timeout ?? 240_000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const query = new URLSearchParams(Object.entries(options.params ?? {}).map(([key, value]) => [key, String(value)]));
    await page.goto(`${url}${HARNESS_PAGE}?${query}`, { waitUntil: 'domcontentloaded' });
    const wanted = 'battle' in (options.params ?? {}) ? 'inBattle' : 'ready';
    await page.waitForFunction(key => { const review = window.review; if (review?.errors.length) throw new Error(review.errors.join('\n')); return review?.[key as 'ready']; }, wanted, { polling: 250 })
      .catch(error => { throw new Error([error.message, ...errors].join('\n')); });
    return { page, browser, url, errors, close };
  } catch (error) { await close(); throw error; }
}

/** PNG through CDP, which leaves window focus (and so drags, ghosts, tooltips and the running battle) alone. */
export async function shot(page: Page, path: string): Promise<string> {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const file = resolve(ROOT, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, Buffer.from(data, 'base64'));
    return file;
  } finally { await cdp.detach(); }
}

/** Seeded designs with their battle ids, as the page reports them. */
export const designs = (page: Page) => page.evaluate(() => window.review.designs);

/** Berth a saved design in port by name. */
export async function berth(page: Page, name: string): Promise<void> {
  const tab = page.locator(`nav[aria-label="Fleet line"] button[aria-label="${name}"]`);
  if (await tab.count()) await tab.first().click();
  else { await page.getByRole('button', { name: 'Open all designs' }).click(); await page.getByRole('button', { name: `View ${name} in port` }).click(); }
  await page.locator(`section.port-identity[aria-label="${name}"]`).waitFor();
}

/** Open a saved design in the ship editor and wait for its viewport. */
export async function openEditor(page: Page, name: string): Promise<void> {
  // A draft that does not compile has no berth; the plan chest still opens it.
  if (await page.evaluate(wanted => window.review.designs.some(design => design.name === wanted && !design.shipId), name)) {
    await page.getByRole('button', { name: 'Open all designs' }).click(); await page.getByRole('button', { name: `Edit ${name}` }).click();
  } else { await berth(page, name); await page.getByRole('button', { name: /edit design/i }).first().click(); }
  await page.locator('.shipbuilder canvas').first().waitFor();
}

/** Advance real time while the battle runs; the simulation is not stepped by hand here. */
export const settle = (page: Page, seconds: number) => page.waitForTimeout(seconds * 1000);

export interface DesignCheck {
  /** The chip's own words: `No warnings`, `2 warnings`, `1 block · 2 warnings`, prefixed `Draft · ` before the first compile. */
  status: string;
  blocks: number;
  warnings: number;
  findings: string[];
  /** The ledger as it reads on screen: `Displacement` → `38,280 t`. */
  ledger: Record<string, string>;
}

/** Wait for the editor's in-browser design check to finish, then read what it decided.
 *
 * The ledger heading carries a `pending`/`last check` badge for exactly as long as there is no
 * current compiled result, so its absence is the settled signal every shipbuilder browser check
 * already uses. On the dev WASM build a first check takes about 30 s. The checks panel is opened to
 * read the findings and closed again, so a capture afterwards shows the editor as it was. */
export async function designCheck(page: Page, timeoutMs = 120_000): Promise<DesignCheck> {
  await page.waitForFunction(() => !document.querySelector('.sb-ledger h4 span'), undefined, { polling: 250, timeout: timeoutMs });
  const chip = page.locator('.sb-warn .lead');
  const status = (await chip.innerText()).replace(/\s*W\s*$/, '').trim();
  const wasOpen = (await chip.getAttribute('aria-expanded')) === 'true';
  if (!wasOpen) await chip.click();
  const panel = await page.evaluate(() => ({
    blocks: document.querySelectorAll('.sb-checks .rows button.row .sb-dot.block').length,
    warnings: document.querySelectorAll('.sb-checks .rows button.row .sb-dot.warn').length,
    findings: [...document.querySelectorAll('.sb-checks .rows button.row span')].map(node => (node.textContent ?? '').trim()).filter(Boolean),
  }));
  if (!wasOpen) await chip.click();
  const ledger = await page.evaluate(() =>
    Object.fromEntries([...document.querySelectorAll('.sb-ledger > .row')].map(row => [row.querySelector('span')?.textContent ?? '', row.querySelector('b')?.textContent ?? ''])));
  return { status, ...panel, ledger };
}
