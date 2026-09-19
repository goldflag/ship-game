import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { DevConsole, type DevConsoleHost } from './DevConsole';
import type { EnvironmentOverrides } from '../game/VisualEnvironment';

const host = (overrides: EnvironmentOverrides): DevConsoleHost => ({
  developerWeather: () => ({ scene: 'battle', locked: false, overrides, seaWind: 22,
    reading: { timeHours: 12, sunElevation: 70, cloudCover: 95, windSpeed: 22, windDirection: 35, visibilityKm: 48 } }),
  setDeveloperWeather() {}, diagnostics: () => ({}), releasePointer() {}, capturePointer() {},
});

test('closed, the console shows only a tag while overrides are live', () => {
  expect(renderToStaticMarkup(<DevConsole host={host({})}/>)).toBe('');
  const tag = renderToStaticMarkup(<DevConsole host={host({ cloudCover: 95, windSpeed: 22 })}/>);
  expect(tag).toContain('dev-console-tag');
  expect(tag).toContain('2 overrides');
});
