/** Live battle regression, using the shared headed browser harness. Captures are seeded presentation fixtures. */
import { launchHarness, shot } from './harness';
import type { ShipView } from '../../src/game/ShipView';
import type { Mesh, MeshBasicMaterial } from 'three/webgpu';

export async function checkShipDamage(): Promise<void> {
  const harness = await launchHarness({ params: { battle: 'bismarck;;fletcher:static' }, timeout: 90_000 });
  const { page } = harness;
  page.setDefaultTimeout(20_000);
  const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };
  try {
    console.log('Battle ready; checking I and part selection.');
    await page.keyboard.press('i');
    await page.getByRole('region', { name: 'Ship damage view' }).waitFor();
    const first = await page.evaluate(() => {
      const g = window.review.game!;
      return { open: g.shipDamageOpen, tick: g.simulation.tick, player: g.diagnostics().portInspection };
    });
    assert(first.open && first.player === 'damage', 'I must inspect our hull, not the target.');
    await page.waitForFunction(tick => window.review.game!.simulation.tick > tick, first.tick);
    await page.getByRole('button', { name: /^All parts/ }).click();
    await page.locator('.ship-damage-part').first().click();
    await page.getByRole('button', { name: 'Show whole ship' }).waitFor();
    assert(await page.evaluate(() => !!window.review.game!.diagnostics().selectedVolume), 'Part selection must reach the 3D ship.');
    await page.getByRole('button', { name: 'Show whole ship' }).click();
    await page.keyboard.press('i');
    await page.getByRole('region', { name: 'Ship damage view' }).waitFor({ state: 'detached' });
    assert(await page.evaluate(() => window.review.game!.diagnostics().portInspection === 'exterior'), 'Closing must restore the exterior.');
    await page.keyboard.press('i'); await page.keyboard.press('Escape');
    await page.getByRole('region', { name: 'Ship damage view' }).waitFor({ state: 'detached' });
    assert(await page.evaluate(() => !window.review.game!.diagnostics().paused), 'Escape should close the inspection before pausing.');
    // Hidden instruments must not hide a deliberately requested inspection.
    await page.keyboard.press('h'); await page.keyboard.press('i');
    assert(await page.locator('.ship-damage').isVisible(), 'I must work with the instruments hidden.');
    await page.keyboard.press('h');
    // Freeze only this diagnostic presentation so seeded damage survives incoming frames.
    console.log('Controls verified; seeding the damage presentation.');
    await page.evaluate(() => { Reflect.set(window.review.game!, 'paused', true); });
    await page.waitForTimeout(250);
    await page.evaluate(() => {
      const g = window.review.game!, actor = g.simulation.player, def = actor.definition;
      actor.damage.integrity = actor.damage.maxIntegrity * .68;
      actor.damage.modules[0].hp = def.modules[0].hp * .35;
      actor.damage.modules[1].hp = 0;
      actor.mounts[0].hp = 42;
      actor.damage.compartments[0].waterM3 = def.compartments[0].capacityM3 * .35;
      actor.damage.compartments[0].breachAreaM2 = .08;
      actor.damage.control.rooms[1].intensity = .65;
      actor.damage.control.rooms[1].heat = .8;
      actor.damage.control.teams[0] = { kind: 'pump', index: 0, setup: 0 };
      actor.damage.control.teams[1] = { kind: 'fire-room', index: 1, setup: 2 };
      actor.damage.regions[0].hp *= .3;
    });
    await page.getByText('42% condition', { exact: true }).waitFor();
    const colors = await page.evaluate(() => {
      const game = window.review.game!, view = Reflect.get(game, 'playerView') as ShipView;
      const group = view.inspection.root.children.find(child => child.userData.inspectionId === `weapon:${view.definition.mounts[0].id}`)!;
      const mesh = group.children[0] as Mesh;
      return { color: (mesh.material as MeshBasicMaterial).color.getHexString(), opacity: (mesh.material as MeshBasicMaterial).opacity };
    });
    assert(colors.color === 'e8c56c' && colors.opacity >= .5, `Damaged gun must be visible in the X-ray: ${JSON.stringify(colors)}`);
    await shot(page, '.build/shots/ship-damage-desktop.png');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.evaluate(() => {
      window.review.game!.setHudScale(1.25);
      document.querySelector<HTMLElement>('.game-shell')!.style.setProperty('--hud-scale', '1.25');
    });
    await page.waitForTimeout(350);
    await shot(page, '.build/shots/ship-damage-scaled.png');
    const layout = await page.locator('.ship-damage').evaluate(el => {
      const r = el.getBoundingClientRect(), list = el.querySelector('.ship-damage-list')!.getBoundingClientRect();
      return { right: r.right, bottom: r.bottom, width: r.width, listHeight: list.height, overflow: el.scrollWidth > el.clientWidth };
    });
    assert(layout.right <= 1280 && layout.bottom <= 800 && layout.listHeight > 100 && !layout.overflow, `Scaled damage view must fit: ${JSON.stringify(layout)}`);
    assert(!harness.errors.length, harness.errors.join('\n'));
    console.log('Ship damage: hotkey, live ticks, own-ship X-ray, selection, close/Escape, hidden HUD, desktop and 125% HUD verified.');
  } catch (error) {
    await shot(page, '.build/shots/ship-damage-failure.png');
    console.error(await page.evaluate(() => ({ diagnostics: window.review.game?.diagnostics(), errors: window.review.errors })));
    throw error;
  } finally { await harness.close(); }
}

if (import.meta.main) await checkShipDamage();
