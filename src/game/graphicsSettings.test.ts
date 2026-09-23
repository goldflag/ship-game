import { expect, test } from 'bun:test';
import { DEFAULT_GRAPHICS, GRAPHICS_PRESETS, GRAPHICS_STORAGE_KEY, PRESET_ORDER, aircraftDetailScale, effectsDensity, frameIntervalMs, launchMatches, loadGraphicsSettings, matchingPreset, nearestPreset, sanitizeGraphicsSettings, sanitizeRenderScale, shadowMapSize, shipDetailBudgetPx, withPreset } from './graphicsSettings';

test('invalid stored graphics recover to High and unknown rows fall back individually', () => {
  for (const value of [null, [], 'bad', 42, { ocean: 'extreme', shadows: 7, renderScale: 'big' }]) {
    expect(sanitizeGraphicsSettings(value)).toEqual(DEFAULT_GRAPHICS);
  }
  expect(sanitizeGraphicsSettings({ ...DEFAULT_GRAPHICS, clouds: 'ultra', frameLimit: 45 })).toEqual({ ...DEFAULT_GRAPHICS, clouds: 'ultra' });
});

test('render scale snaps to five percent steps between 50 and 100', () => {
  expect(sanitizeRenderScale(65)).toBe(65);
  expect(sanitizeRenderScale(67)).toBe(65);
  expect(sanitizeRenderScale(12)).toBe(50);
  expect(sanitizeRenderScale(140)).toBe(100);
  for (const value of [NaN, Infinity, '80', undefined]) expect(sanitizeRenderScale(value)).toBe(100);
});

test('every preset matches itself and a single change reads as custom from the nearest preset', () => {
  for (const name of PRESET_ORDER) expect(matchingPreset({ ...GRAPHICS_PRESETS[name] })).toBe(name);
  const custom = { ...GRAPHICS_PRESETS.high, reflections: 'sky' as const };
  expect(matchingPreset(custom)).toBeNull();
  expect(nearestPreset(custom)).toBe('high');
  expect(nearestPreset({ ...GRAPHICS_PRESETS.low, renderScale: 100 })).toBe('low');
  expect(matchingPreset({ ...GRAPHICS_PRESETS.medium, renderScale: 100 })).toBe('medium');
});

test('subsystem mappings preserve the former High tier and order the others monotonically', () => {
  expect(shadowMapSize('off')).toBe(0);
  expect([shadowMapSize('low'), shadowMapSize('medium'), shadowMapSize('high')]).toEqual([1024, 2048, 4096]);
  expect(shipDetailBudgetPx('high')).toBe(1.25);
  expect(shipDetailBudgetPx('low')).toBeGreaterThan(shipDetailBudgetPx('medium'));
  expect(shipDetailBudgetPx('full')).toBeLessThan(shipDetailBudgetPx('high'));
  expect(aircraftDetailScale('high')).toBe(1);
  expect(effectsDensity('high')).toBe(1);
  expect(effectsDensity('low')).toBeLessThan(effectsDensity('medium'));
  expect(frameIntervalMs(0)).toBe(0);
  expect(frameIntervalMs(60)).toBeCloseTo(16.667, 2);
});

test('graphics settings load from the stored key and tolerate unavailable storage', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) } });
  try {
    expect(loadGraphicsSettings()).toEqual(DEFAULT_GRAPHICS);
    store.set(GRAPHICS_STORAGE_KEY, JSON.stringify({ ...GRAPHICS_PRESETS.ultra, readout: 'detailed' }));
    expect(loadGraphicsSettings()).toEqual({ ...GRAPHICS_PRESETS.ultra, readout: 'detailed' });
    store.set(GRAPHICS_STORAGE_KEY, '{not json');
    expect(loadGraphicsSettings()).toEqual(DEFAULT_GRAPHICS);
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('blocked'); } });
    expect(loadGraphicsSettings()).toEqual(DEFAULT_GRAPHICS);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original); else delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});


test('water shadows migrate old presets and stay independently configurable without a reload', () => {
  for (const name of PRESET_ORDER) {
    const { waterShadows, ...oldSave } = GRAPHICS_PRESETS[name];
    expect(sanitizeGraphicsSettings(oldSave)).toEqual(GRAPHICS_PRESETS[name]);
  }
  for (const waterShadows of ['off', 'low', 'medium', 'high'] as const) {
    const settings = { ...DEFAULT_GRAPHICS, waterShadows };
    expect(sanitizeGraphicsSettings(JSON.parse(JSON.stringify(settings)))).toEqual(settings);
    expect(launchMatches(DEFAULT_GRAPHICS, settings)).toBe(true);
    // Disabling global shadows preserves the chosen filter for re-enabling.
    expect(sanitizeGraphicsSettings({ ...settings, shadows: 'off' }).waterShadows).toBe(waterShadows);
  }
  expect(matchingPreset({ ...DEFAULT_GRAPHICS, waterShadows: 'medium' })).toBeNull();
  expect(sanitizeGraphicsSettings({ ...DEFAULT_GRAPHICS, waterShadows: 'invalid' }).waterShadows).toBe('high');
});

test('the ocean renderer comparison persists, rebuilds the port and stays outside the quality presets', () => {
  expect(DEFAULT_GRAPHICS.oceanRenderer).toBe('game');
  const library = { ...DEFAULT_GRAPHICS, oceanRenderer: 'waterpro' as const };
  expect(sanitizeGraphicsSettings(JSON.parse(JSON.stringify(library)))).toEqual(library);
  for (const value of [undefined, 'fft', 3]) expect(sanitizeGraphicsSettings({ ...DEFAULT_GRAPHICS, oceanRenderer: value }).oceanRenderer).toBe('game');
  // Older saves have no renderer and keep every other row.
  const { oceanRenderer, ...oldSave } = GRAPHICS_PRESETS.ultra;
  expect(sanitizeGraphicsSettings(oldSave)).toEqual(GRAPHICS_PRESETS.ultra);
  expect(launchMatches(DEFAULT_GRAPHICS, library)).toBe(false);
  expect(launchMatches(library, library)).toBe(true);
  expect(matchingPreset(library)).toBe('high');
  for (const name of PRESET_ORDER) expect(withPreset(library, name)).toEqual({ ...GRAPHICS_PRESETS[name], oceanRenderer: 'waterpro' });
  expect(withPreset(DEFAULT_GRAPHICS, 'low')).toEqual(GRAPHICS_PRESETS.low);
});
