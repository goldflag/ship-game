import { expect, test } from 'bun:test';
import { DEFAULT_GRAPHICS, GRAPHICS_PRESETS, GRAPHICS_STORAGE_KEY, LEGACY_STORAGE_KEY, PRESET_ORDER, aircraftDetailScale, effectsDensity, frameIntervalMs, loadGraphicsSettings, matchingPreset, nearestPreset, sanitizeGraphicsSettings, sanitizeRenderScale, shadowMapSize, shipDetailBudgetPx } from './graphicsSettings';

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

test('legacy ocean-detail tiers migrate to their presets and keep the saved render scale', () => {
  expect(sanitizeGraphicsSettings({ quality: 'medium', resolution: 0.65 })).toEqual({ ...GRAPHICS_PRESETS.medium, renderScale: 65 });
  expect(sanitizeGraphicsSettings({ quality: 'ultra', resolution: 1 })).toEqual(GRAPHICS_PRESETS.ultra);
  expect(sanitizeGraphicsSettings({ quality: 'high', resolution: 0.8 })).toEqual({ ...GRAPHICS_PRESETS.high, renderScale: 80 });
  expect(sanitizeGraphicsSettings({ quality: 'other' })).toEqual(GRAPHICS_PRESETS.high);
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

test('graphics settings load from the new key, migrate the legacy key and tolerate unavailable storage', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) } });
  try {
    expect(loadGraphicsSettings()).toEqual(DEFAULT_GRAPHICS);
    store.set(LEGACY_STORAGE_KEY, JSON.stringify({ quality: 'medium', resolution: 0.8 }));
    expect(loadGraphicsSettings()).toEqual({ ...GRAPHICS_PRESETS.medium, renderScale: 80 });
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
