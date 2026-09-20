import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HUD_LAYERS, HUD_LAYER_FIELDS, PROJECTED_HUD_LAYER_FIELDS, hudScaleSelector } from './hudLayers';

const normalize = (selector: string) => selector.replace(/\s+/g, ' ').trim();

test('the --hud-scale rule in styles.css scales exactly the registered HUD layers', () => {
  const css = readFileSync(resolve(import.meta.dir, 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, , body]) => body.includes('scale(var(--hud-scale'));
  if (rules.length !== 1)
    throw new Error(`Expected one rule applying transform: scale(var(--hud-scale …)) in src/ui/styles.css, found ${rules.length}.`);
  const actual = normalize(rules[0][1]),
    expected = hudScaleSelector();
  if (actual !== expected) {
    throw new Error(
      [
        'The HUD layer registry and the --hud-scale CSS rule disagree.',
        `  src/ui/hudLayers.ts expects: ${expected}`,
        `  src/ui/styles.css has:       ${actual}`,
        'Edit HUD_LAYERS in src/ui/hudLayers.ts and the selector of the --hud-scale rule in src/ui/styles.css so they list the same layers.',
      ].join('\n'),
    );
  }
});

test('every HUD layer has its own class and something for Game.setHudScale to resize', () => {
  const classes = HUD_LAYER_FIELDS.map((field) => HUD_LAYERS[field].className);
  expect(new Set(classes).size).toBe(classes.length);
  expect(PROJECTED_HUD_LAYER_FIELDS.length).toBeGreaterThan(0);
});
