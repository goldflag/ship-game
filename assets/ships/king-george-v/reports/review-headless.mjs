/** Isolated Chrome fallback when Orca's desktop page cannot persist.
 * Temporary tooling: create .build/kgv-browser-review/package.json with playwright-core 1.55.1, then bun install --cwd .build/kgv-browser-review
 * Run: node assets/ships/king-george-v/reports/review-headless.mjs
 * Uses the same retained production Game fixture as review-browser.py.
 */
import { chromium } from '../../../../.build/kgv-browser-review/node_modules/playwright-core/index.mjs';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const out = fileURLToPath(new URL('.', import.meta.url));
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
const save = (name, value) => writeFile(out + name + '.json', JSON.stringify(value, null, 2) + '\n');
const evaluate = expression => page.evaluate(expression);
async function capture(name) {
  const value = await evaluate('(async()=>{const t=window.kingGeorgeTrial;await t.still();await t.game.pipeline.render();return {hash:t.report.contentHash,image:t.game.renderer.domElement.toDataURL("image/png")};})()');
  await writeFile(out + name + '.png', Buffer.from(value.image.split(',')[1], 'base64'));
  console.log('Captured', name, value.hash);
}
try {
  await page.goto('http://localhost:61731/assets/ships/king-george-v/reports/sea-trial.html');
  await page.waitForFunction('Boolean(window.kingGeorgeTrial)', null, { timeout: 180000 });
  console.log('Production scene ready');
  const browserInfo = await evaluate('({userAgent:navigator.userAgent,webGPUAvailable:Boolean(navigator.gpu),hash:window.kingGeorgeTrial.report.contentHash,diagnostics:window.kingGeorgeTrial.game.diagnostics()})');
  await save('headless-browser', { ...browserInfo, tooling: 'playwright-core 1.55.1 with installed Google Chrome', errors });
  for (const [battery, ammunition] of [['main', 'ap'], ['secondary', 'ap'], ['secondary', 'he']]) {
    const value = await evaluate(`window.kingGeorgeTrial.battery(${JSON.stringify(battery)},${JSON.stringify(ammunition)})`);
    await save(battery + '-' + ammunition + '-trial', value);
    console.log(battery, ammunition, JSON.stringify(value));
    await capture('sea-trial-' + battery + '-' + ammunition);
  }
  await save('damage-trial', await evaluate('window.kingGeorgeTrial.damage()'));
  await capture('sea-trial-damage');
  await save('reset-trial', await evaluate('window.kingGeorgeTrial.reset()'));
  await save('sea-trial', await evaluate('window.kingGeorgeTrial.report'));
  for (const [name, pose] of [
    ['elevation', { trainFraction: 0, elevationFraction: 1, recoilFraction: 1 }],
    ['starboard', { trainFraction: 1, elevationFraction: 1, recoilFraction: 1 }],
    ['port', { trainFraction: -1, elevationFraction: 0, recoilFraction: 0 }],
    ['restored', null],
  ]) {
    await evaluate('window.kingGeorgeTrial.game.previewArticulation(' + JSON.stringify(pose) + ')');
    const value = await evaluate('(async()=>{const t=window.kingGeorgeTrial;await t.still();return t.game.diagnostics();})()');
    if (!value.inPort || value.maxMuzzleErrorM > .025) throw new Error('Articulation mismatch: ' + JSON.stringify(value));
    await save('articulation-' + name, value);
    await capture('articulation-' + name);
  }
  await capture('in-game-refined');
  await evaluate('(()=>{const g=window.kingGeorgeTrial.game,p=g.simulation.player.motion;g.camera.position.set(p.x+55,p.y+24,p.z-83);g.camera.lookAt(p.x,p.y+10,p.z-45);g.camera.updateMatrixWorld();})()');
  await capture('turrets-in-game');
  await evaluate('window.kingGeorgeTrial.game.previewArticulation({trainFraction:0,elevationFraction:1,recoilFraction:1})');
  await capture('turrets-elevated-in-game');
  await evaluate('window.kingGeorgeTrial.game.previewArticulation(null)');
  await evaluate('window.kingGeorgeTrial.reset()');
  for (const mode of ['armor', 'internals']) {
    await evaluate('window.kingGeorgeTrial.game.playerView.setInspection(' + JSON.stringify(mode) + ')');
    await capture('in-game-' + mode);
  }
  await evaluate('window.kingGeorgeTrial.game.playerView.setInspection("internals","module:boiler-1-1")');
  await capture('in-game-isolation');
  await evaluate('window.kingGeorgeTrial.game.playerView.setInspection("exterior")');
  await save('headless-browser', { ...browserInfo, tooling: 'playwright-core 1.55.1 with installed Google Chrome', errors, complete: true });
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('Firing, damage, flooding, reset, articulation and inspection complete.');
} finally {
  await browser.close();
}
