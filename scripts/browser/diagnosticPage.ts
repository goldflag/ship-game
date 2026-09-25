/** Headed Chromium for the standalone diagnostics pages (`scripts/diagnostics/ocean-*.html` and the like), which answer
 * `window.ready` rather than the harness page's `window.review`. `harness.ts` drives the game itself. */
import { chromium, type Browser, type ConsoleMessage, type Page } from 'playwright';

/** Headless Chromium stalls WebGPU. Several windows (a baseline and a branch) must keep drawing while another has focus. */
export const launchDiagnosticBrowser = (width = 1600, height = 990) => chromium.launch({ headless: false,
  args: ['--enable-unsafe-webgpu', '--window-position=0,0', `--window-size=${width},${height}`,
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'],
  ...(process.env.HARNESS_CHROME ? { executablePath: process.env.HARNESS_CHROME } : {}) });

/** A console message as a page-error line, or nothing for types that are not collected. A failed resource names its URL,
 * which Chromium leaves out of the text, so the line says what to fix instead of "Failed to load resource … 404". */
export function consoleProblem(type: string, text: string, url?: string, warnings = false): string | undefined {
  if (type !== 'error' && !(warnings && type === 'warning')) return undefined;
  return text.startsWith('Failed to load resource') && url ? `${text}: ${url}` : text;
}

export interface DiagnosticPage { page: Page; errors: string[] }

/** Opens `url` in its own window (a context of its own, so two pages draw side by side rather than as a hidden tab), collects
 * page errors and console errors (and warnings with `warnings`), and waits for `window.ready`. */
export async function openDiagnosticPage(browser: Browser, url: string, options: { viewport?: { width: number; height: number }; warnings?: boolean } = {}): Promise<DiagnosticPage> {
  const context = await browser.newContext({ viewport: options.viewport ?? { width: 1600, height: 900 } });
  const page = await context.newPage(), errors: string[] = [];
  page.setDefaultTimeout(600_000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', (message: ConsoleMessage) => {
    const line = consoleProblem(message.type(), message.text(), message.location().url, options.warnings);
    if (line) errors.push(line);
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as unknown as { ready?: boolean }).ready, undefined, { polling: 250 });
  return { page, errors };
}
