/** Plain request and report shapes of `ship:view`, shared by the CLI and the browser stage. No three.js or DOM here. */
export type ViewMode = 'exterior' | 'armor' | 'internals' | 'ids';
export type ViewPreset = 'profile' | 'plan' | 'bow' | 'stern' | 'quarter';
export type Vec3 = [number, number, number];
export const VIEW_MODES: readonly ViewMode[] = ['exterior', 'armor', 'internals', 'ids'];
/** Ship axes: +x starboard, +y up, -z bow. Azimuth is the camera's compass bearing from the ship with the bow at 0°
 * and starboard at 90°; elevation is its height above the horizon. The presets match the fixed `render` views. */
export const VIEW_PRESETS: Record<ViewPreset, { azimuthDeg: number; elevationDeg: number }> = {
  profile: { azimuthDeg: 90, elevationDeg: 0 },
  plan: { azimuthDeg: 270, elevationDeg: 90 },
  bow: { azimuthDeg: 0, elevationDeg: 0 },
  stern: { azimuthDeg: 180, elevationDeg: 0 },
  quarter: { azimuthDeg: 45, elevationDeg: Math.atan2(0.6, Math.SQRT2) * 180 / Math.PI },
};
export const MAX_VIEW_SIZE = { width: 3200, height: 2400 }, DEFAULT_VIEW_SIZE = { width: 1600, height: 1000 };

export interface ViewRequest {
  name: string;
  azimuthDeg: number;
  elevationDeg: number;
  mode: ViewMode;
  width: number;
  height: number;
  /** No explicit --size: an orthographic image may shrink one side to the framing's shape. */
  trim: boolean;
  zoom: number;
  perspective: boolean;
  focus: string[];
  isolate: boolean;
  highlight: string[];
  region?: [Vec3, Vec3];
  /** `auto` removes the half nearer the camera. */
  section?: { axis: 'x' | 'y' | 'z'; value: number; keep: 'auto' | 'below' | 'above' };
}

/** Unit vector from the target to the camera, and the camera's up. A vertical view keeps the far side of the azimuth at the top. */
export function viewDirection(azimuthDeg: number, elevationDeg: number): { direction: Vec3; up: Vec3 } {
  const azimuth = azimuthDeg * Math.PI / 180, elevation = elevationDeg * Math.PI / 180;
  const clean = (value: number) => Math.abs(value) < 1e-12 ? 0 : value;
  const direction: Vec3 = [clean(Math.sin(azimuth) * Math.cos(elevation)), clean(Math.sin(elevation)), clean(-Math.cos(azimuth) * Math.cos(elevation))];
  const vertical = Math.abs(Math.cos(elevation)) < 1e-6;
  return { direction, up: vertical ? [clean(-Math.sin(azimuth) * Math.sign(elevation)), 0, clean(Math.cos(azimuth) * Math.sign(elevation))] : [0, 1, 0] };
}

const number = (text: string, label: string) => {
  const value = Number(text);
  if (text.trim() === '' || !Number.isFinite(value)) throw new Error(label + ' must be a finite number, got ' + JSON.stringify(text) + '.');
  return value;
};
const list = (text: string | undefined) => (text ?? '').split(',').map(value => value.trim()).filter(Boolean);

export interface ViewFlags {
  view?: string; azimuth?: string; elevation?: string; mode?: string; size?: string; zoom?: string; focus?: string; highlight?: string;
  region?: string; section?: string; perspective?: boolean; isolate?: boolean;
}
/** One request per `--view` name; an explicit azimuth or elevation overrides that part of every preset. */
export function viewRequests(flags: ViewFlags): ViewRequest[] {
  const mode = (flags.mode ?? 'exterior') as ViewMode;
  if (!VIEW_MODES.includes(mode)) throw new Error('Unknown --mode ' + JSON.stringify(flags.mode) + '. Use ' + VIEW_MODES.join('|') + '.');
  let { width, height } = DEFAULT_VIEW_SIZE;
  if (flags.size !== undefined) {
    const match = /^(\d+)x(\d+)$/i.exec(flags.size.trim());
    if (!match) throw new Error('--size is WIDTHxHEIGHT in pixels, such as 1600x1000.');
    [width, height] = [Number(match[1]), Number(match[2])];
    if (width < 64 || height < 64 || width > MAX_VIEW_SIZE.width || height > MAX_VIEW_SIZE.height)
      throw new Error(`--size must be from 64x64 to ${MAX_VIEW_SIZE.width}x${MAX_VIEW_SIZE.height}.`);
  }
  const zoom = flags.zoom === undefined ? 1 : number(flags.zoom, '--zoom');
  if (zoom < 0.05 || zoom > 200) throw new Error('--zoom must be from 0.05 to 200.');
  const focus = list(flags.focus), highlight = list(flags.highlight);
  if (flags.isolate && !focus.length) throw new Error('--isolate needs --focus id,id.');
  let region: ViewRequest['region'];
  if (flags.region !== undefined) {
    const values = flags.region.split(',').map(value => number(value, '--region'));
    if (values.length !== 6) throw new Error('--region is x0,y0,z0,x1,y1,z1 in ship metres.');
    region = [[0, 1, 2].map(i => Math.min(values[i], values[i + 3])) as Vec3, [0, 1, 2].map(i => Math.max(values[i], values[i + 3])) as Vec3];
  }
  let section: ViewRequest['section'];
  if (flags.section !== undefined) {
    const match = /^([xyz])\s*(=|<|>)\s*(.+)$/i.exec(flags.section.trim());
    if (!match) throw new Error('--section is x=value, y=value or z=value (keeps the half away from the camera); "x<value" or "x>value" names the kept half.');
    section = { axis: match[1].toLowerCase() as 'x' | 'y' | 'z', value: number(match[3], '--section'), keep: match[2] === '>' ? 'above' : match[2] === '<' ? 'below' : 'auto' };
  }
  const names = flags.view === undefined ? ['quarter'] : list(flags.view);
  if (!names.length) throw new Error('--view needs at least one of ' + Object.keys(VIEW_PRESETS).join('|') + '.');
  if (new Set(names).size !== names.length) throw new Error('--view names must be distinct.');
  const azimuth = flags.azimuth === undefined ? undefined : number(flags.azimuth, '--azimuth');
  const elevation = flags.elevation === undefined ? undefined : number(flags.elevation, '--elevation');
  if (elevation !== undefined && Math.abs(elevation) > 90) throw new Error('--elevation must be from -90 to 90.');
  if ((azimuth !== undefined || elevation !== undefined) && names.length > 1) throw new Error('--azimuth/--elevation apply to a single view; give one --view name or none.');
  return names.map(name => {
    const preset = VIEW_PRESETS[name as ViewPreset];
    if (!preset) throw new Error('Unknown --view ' + JSON.stringify(name) + '. Use ' + Object.keys(VIEW_PRESETS).join('|') + ', or --azimuth/--elevation.');
    const custom = azimuth !== undefined || elevation !== undefined;
    return {
      name: custom && flags.view === undefined ? 'custom' : name, azimuthDeg: azimuth ?? preset.azimuthDeg, elevationDeg: elevation ?? preset.elevationDeg,
      mode, width, height, trim: flags.size === undefined, zoom, perspective: !!flags.perspective, focus, isolate: !!flags.isolate, highlight, region, section,
    };
  });
}

/** Distinct flat colours for the `ids` mode: golden-angle hues over three lightness bands, never the background or highlight. */
export function idColors(count: number): string[] {
  const colors: string[] = [], used = new Set<string>();
  const channel = (value: number) => Math.round(value * 255).toString(16).padStart(2, '0');
  for (let i = 0, step = 0; colors.length < count; step++) {
    const hue = (step * 0.61803398875) % 1, saturation = [0.9, 0.65, 1][step % 3], lightness = [0.55, 0.38, 0.72][Math.floor(step / 3) % 3];
    const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation, p = 2 * lightness - q;
    const part = (t: number) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    const color = '#' + channel(part(hue + 1 / 3)) + channel(part(hue)) + channel(part(hue - 1 / 3));
    if (used.has(color)) continue;
    used.add(color); colors[i++] = color;
  }
  return colors;
}
