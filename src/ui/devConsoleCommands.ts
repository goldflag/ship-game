import { formatBattleTime } from '../maps/conditions';
import type { EnvironmentOverrides, EnvironmentReading } from '../game/VisualEnvironment';
import type { OceanRealism } from '../game/ocean/contracts';

/** Shift-D opens the developer console in port and at sea. Other window key
 * handlers step aside for it so a selected flight's D never swallows it. */
export const isDeveloperConsoleKey = (event: Pick<KeyboardEvent, 'code' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey'>) =>
  event.code === 'KeyD' && event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey;

export type WeatherKey = 'timeHours' | 'cloudCover' | 'windSpeed' | 'windDirection' | 'visibilityKm';
export interface WeatherSetting {
  kind: 'setting'; key: WeatherKey; group: 'Weather'; label: string; words: string[];
  min: number; max: number; wrap?: boolean;
  /** Units per pixel when a value chip is dragged. */
  scrub: number;
  format(value: number): string;
}
export interface WeatherPreset { kind: 'preset'; id: string; group: 'Weather'; label: string; words: string[]; overrides: EnvironmentOverrides; }
/** A realism feature the console switches off and on, to compare it with the look first tuned to the replaced library. */
export type RealismToggle = `realism:${keyof OceanRealism}`;
export interface ConsoleAction { kind: 'action'; id: 'reset' | 'diagnostics' | 'bowWaves' | 'oceanRenderer' | RealismToggle; group: 'Weather' | 'Diagnostics' | 'Water'; label: string; words: string[]; }
export type ConsoleCommand = WeatherSetting | WeatherPreset | ConsoleAction;

const trim = (value: number, digits = 1) => String(Number(value.toFixed(digits)));
export const WEATHER_SETTINGS: WeatherSetting[] = [
  { kind: 'setting', key: 'timeHours', group: 'Weather', label: 'Time of day', words: ['time', 'day', 'hour', 'clock', 'sun'], min: 0, max: 24, wrap: true, scrub: .04, format: formatBattleTime },
  { kind: 'setting', key: 'cloudCover', group: 'Weather', label: 'Cloud cover', words: ['cloud', 'clouds', 'cover', 'sky'], min: 0, max: 100, scrub: .25, format: value => `${Math.round(value)}%` },
  { kind: 'setting', key: 'windSpeed', group: 'Weather', label: 'Wind speed', words: ['wind', 'speed', 'sea', 'waves'], min: 0, max: 30, scrub: .05, format: value => `${trim(value)} m/s` },
  { kind: 'setting', key: 'windDirection', group: 'Weather', label: 'Wind from', words: ['wind', 'from', 'direction', 'bearing'], min: 0, max: 360, wrap: true, scrub: .5, format: value => `${String(Math.round(value) % 360).padStart(3, '0')}°` },
  { kind: 'setting', key: 'visibilityKm', group: 'Weather', label: 'Visibility', words: ['visibility', 'fog', 'haze', 'vis'], min: .5, max: 80, scrub: .1, format: value => `${trim(value)} km` },
];
export const WEATHER_PRESETS: WeatherPreset[] = [
  { id: 'dawn', label: 'Dawn', overrides: { timeHours: 6.4 } },
  { id: 'noon', label: 'Noon', overrides: { timeHours: 12 } },
  { id: 'dusk', label: 'Dusk', overrides: { timeHours: 18.3 } },
  { id: 'night', label: 'Night', overrides: { timeHours: 23 } },
  { id: 'calm', label: 'Calm', overrides: { cloudCover: 5, windSpeed: 2 } },
  { id: 'overcast', label: 'Overcast', overrides: { cloudCover: 85, windSpeed: 12 } },
  { id: 'storm', label: 'Storm', overrides: { cloudCover: 95, windSpeed: 22, visibilityKm: 12 } },
].map(preset => ({ ...preset, kind: 'preset', group: 'Weather', words: [preset.id, 'preset'] }));
export const CONSOLE_ACTIONS: ConsoleAction[] = [
  { kind: 'action', id: 'reset', group: 'Weather', label: 'Reset weather to the scene', words: ['reset', 'clear', 'scene', 'default'] },
  { kind: 'action', id: 'diagnostics', group: 'Diagnostics', label: 'Copy scene diagnostics', words: ['diagnostics', 'copy', 'debug', 'snapshot'] },
  { kind: 'action', id: 'bowWaves', group: 'Water', label: 'Toggle bow waves', words: ['bow', 'waves', 'wake', 'kelvin', 'toggle'] },
  { kind: 'action', id: 'realism:seaState', group: 'Water', label: 'Toggle realistic sea state', words: ['realistic', 'realism', 'sea', 'state', 'steepness', 'toggle'] },
  { kind: 'action', id: 'realism:reflections', group: 'Water', label: 'Toggle physical reflections', words: ['physical', 'realism', 'reflections', 'fresnel', 'glitter', 'toggle'] },
  { kind: 'action', id: 'realism:waterColor', group: 'Water', label: 'Toggle physical water colour', words: ['physical', 'realism', 'water', 'colour', 'color', 'toggle'] },
  { kind: 'action', id: 'realism:wake', group: 'Water', label: 'Toggle realistic wakes', words: ['realistic', 'realism', 'wakes', 'slick', 'toggle'] },
  { kind: 'action', id: 'realism:atmosphere', group: 'Water', label: 'Toggle realistic haze', words: ['realistic', 'realism', 'haze', 'atmosphere', 'fog', 'toggle'] },
  // The vendored library the game's ocean replaced, kept to compare the two in the real game.
  { kind: 'action', id: 'oceanRenderer', group: 'Water', label: 'Switch ocean renderer', words: ['switch', 'ocean', 'renderer', 'water', 'pro', 'waterpro', 'library', 'compare', 'comparison', 'toggle'] },
];
export const CONSOLE_COMMANDS: ConsoleCommand[] = [...WEATHER_SETTINGS, ...WEATHER_PRESETS, ...CONSOLE_ACTIONS];

export function clampSetting(setting: WeatherSetting, value: number): number {
  if (setting.wrap) return ((value - setting.min) % (setting.max - setting.min) + (setting.max - setting.min)) % (setting.max - setting.min) + setting.min;
  return Math.max(setting.min, Math.min(setting.max, value));
}
/** Clock time (`6:30`) or a number with an optional unit. */
export function parseValue(key: WeatherKey, token: string): number | undefined {
  const clock = key === 'timeHours' ? /^(\d{1,2}):(\d{2})$/.exec(token) : null;
  if (clock) return Number(clock[1]) + Number(clock[2]) / 60;
  const number = /^(-?\d+(?:\.\d+)?)(?:%|°|m\/s|km|h)?$/.exec(token);
  return number ? Number(number[1]) : undefined;
}

export interface ConsoleMatch { command: ConsoleCommand; value?: number; }
/** Every text word must begin one of a command's words; a number sets a value. */
export function matchCommands(query: string, locked = false): ConsoleMatch[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const valueToken = tokens.find(token => /^-?\d/.test(token));
  const words = tokens.filter(token => token !== valueToken);
  const matches: ConsoleMatch[] = [];
  for (const command of CONSOLE_COMMANDS) {
    if (locked && command.kind !== 'action') continue;
    if (locked && command.kind === 'action' && command.id === 'reset') continue;
    if (!words.every(word => command.words.some(candidate => candidate.startsWith(word)) || command.label.toLowerCase().split(/\s+/).some(part => part.startsWith(word)))) continue;
    if (valueToken === undefined) { matches.push({ command }); continue; }
    if (command.kind !== 'setting') continue;
    const value = parseValue(command.key, valueToken);
    if (value !== undefined) matches.push({ command, value: clampSetting(command, value) });
  }
  return matches;
}

/** The scene's value for a setting. Sheltered port light has no clock, so its
 * time follows the sun's elevation on the morning side of the day model. */
export function currentValue(key: WeatherKey, reading: EnvironmentReading): number {
  if (key !== 'timeHours') return reading[key];
  if (reading.timeHours !== undefined) return reading.timeHours;
  return 6 + Math.asin(Math.max(-1, Math.min(1, reading.sunElevation / 70))) * 12 / Math.PI;
}
export function readingLabel(key: WeatherKey, reading: EnvironmentReading): string {
  if (key === 'timeHours' && reading.timeHours === undefined) return `sun ${Math.round(reading.sunElevation)}°`;
  const setting = WEATHER_SETTINGS.find(s => s.key === key)!;
  const label = setting.format(currentValue(key, reading));
  return key === 'timeHours' ? `${label} · sun ${Math.round(reading.sunElevation)}°` : label;
}
export const overrideCount = (overrides: EnvironmentOverrides) => Object.values(overrides).filter(value => value !== undefined).length;
