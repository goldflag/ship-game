// Run against this checkout's Vite server, passing its URL as the first argument.
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(new URL('/scripts/diagnostics/construction-check.html', process.argv[2]).href);
  const result = await page.evaluate(async () => (await import('/scripts/tests/shipbuilder-internals-browser.ts')).checkInternalModulePlacement());
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
