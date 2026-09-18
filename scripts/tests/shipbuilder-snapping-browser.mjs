// bun scripts/tests/shipbuilder-snapping-browser.mjs <vite-url>
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const output = '.build/snap-review';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(new URL('/scripts/diagnostics/construction-check.html', process.argv[2] ?? 'http://127.0.0.1:5200').href);
  const checks = await page.evaluate(async () => (await import('/scripts/tests/shipbuilder-snapping-browser.ts')).checkSnapping());
  await page.screenshot({ path: `${output}/centerline.png` });
  await page.evaluate(async () => {
    const { controls } = await import('/scripts/tests/shipbuilder-browser.tsx');
    const [clientX, clientY] = await controls.screen([-1.48, 1, -4]);
    document.querySelector('canvas').dispatchEvent(new PointerEvent('pointermove', { clientX, clientY, bubbles: true, pointerId: 41 }));
  });
  await page.waitForTimeout(100);
  await page.screenshot({ path: `${output}/geometry.png` });
  await page.keyboard.press('n');
  await page.screenshot({ path: `${output}/off.png` });
  for (const [name, width, height] of [['desktop', 1440, 960], ['compact', 900, 700]]) {
    await page.setViewportSize({ width, height });
    await page.locator('.sb-snap-options').click();
    const panel = page.locator('.sb-snap-popover');
    await panel.waitFor();
    if (!(await panel.textContent()).includes('Free placement. Snap guides are hidden.')) throw new Error('Off state does not explain hidden feedback');
    const rect = await panel.boundingBox();
    if (!rect || rect.x < 0 || rect.y < 0 || rect.x + rect.width > width || rect.y + rect.height > height) throw new Error(`Snap settings overflow at ${width} × ${height}`);
    await page.screenshot({ path: `${output}/settings-${name}.png` });
    await page.keyboard.press('Escape');
    checks.push(`Snap settings fit ${width} × ${height}, explain Off and close with Escape`);
  }
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
} finally {
  await browser.close();
}
