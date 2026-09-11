export type GraphicsPreset = 'low' | 'medium' | 'high' | 'ultra';
export type OceanQuality = 'low' | 'medium' | 'high' | 'ultra';
export type CloudQuality = 'low' | 'medium' | 'high' | 'ultra';
export type ShadowQuality = 'off' | 'low' | 'medium' | 'high';
export type ModelDetail = 'low' | 'medium' | 'high' | 'full';
export type TerrainQuality = 'medium' | 'high';
export type EffectsQuality = 'low' | 'medium' | 'high';
export type Antialiasing = 'off' | 'fxaa' | 'smaa';
export type Reflections = 'sky' | 'scene';
export type PerformanceReadoutMode = 'hidden' | 'fps' | 'detailed';
/** Frames per second; 0 follows the display refresh. */
export type FrameLimit = 0 | 30 | 60 | 120;

export interface GraphicsSettings {
  /** Percent of the capped device resolution, 50–100 in steps of 5. */
  renderScale: number;
  frameLimit: FrameLimit;
  antialiasing: Antialiasing;
  /** Water Pro tier; applies when the port next loads. */
  ocean: OceanQuality;
  reflections: Reflections;
  clouds: CloudQuality;
  shadows: ShadowQuality;
  modelDetail: ModelDetail;
  /** Harbor and island mesh density; applies when the port next loads or the next battle starts. */
  terrain: TerrainQuality;
  effects: EffectsQuality;
  readout: PerformanceReadoutMode;
}

/** The shape saved before graphics became configurable per subsystem. */
export interface LegacyGameSettings { quality: 'medium' | 'high' | 'ultra'; resolution: number; }

export const GRAPHICS_STORAGE_KEY = 'fleet-graphics-settings';
export const LEGACY_STORAGE_KEY = 'bismarck-settings';
export const RENDER_SCALE_MIN = 50;
export const RENDER_SCALE_STEP = 5;
export const FRAME_LIMITS: readonly FrameLimit[] = [0, 120, 60, 30];

/** High reproduces the ocean, sky, shadow and terrain choices of the former High tier exactly. */
export const GRAPHICS_PRESETS: Readonly<Record<GraphicsPreset, Readonly<GraphicsSettings>>> = {
  low: { renderScale: 75, frameLimit: 0, antialiasing: 'fxaa', ocean: 'low', reflections: 'sky', clouds: 'low', shadows: 'off', modelDetail: 'low', terrain: 'medium', effects: 'low', readout: 'fps' },
  medium: { renderScale: 100, frameLimit: 0, antialiasing: 'fxaa', ocean: 'medium', reflections: 'sky', clouds: 'medium', shadows: 'low', modelDetail: 'medium', terrain: 'medium', effects: 'medium', readout: 'fps' },
  high: { renderScale: 100, frameLimit: 0, antialiasing: 'fxaa', ocean: 'high', reflections: 'scene', clouds: 'medium', shadows: 'medium', modelDetail: 'high', terrain: 'high', effects: 'high', readout: 'fps' },
  ultra: { renderScale: 100, frameLimit: 0, antialiasing: 'smaa', ocean: 'ultra', reflections: 'scene', clouds: 'high', shadows: 'high', modelDetail: 'full', terrain: 'high', effects: 'high', readout: 'fps' },
};
export const PRESET_ORDER: readonly GraphicsPreset[] = ['low', 'medium', 'high', 'ultra'];
export const DEFAULT_GRAPHICS: Readonly<GraphicsSettings> = GRAPHICS_PRESETS.high;

const oneOf = <T extends string>(value: unknown, choices: readonly T[], fallback: T): T => choices.includes(value as T) ? value as T : fallback;

export function sanitizeRenderScale(value: unknown, fallback = DEFAULT_GRAPHICS.renderScale): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const stepped = Math.round(value / RENDER_SCALE_STEP) * RENDER_SCALE_STEP;
  return Math.max(RENDER_SCALE_MIN, Math.min(100, stepped));
}

/** Accepts the current shape, the legacy `{ quality, resolution }` object, or garbage. */
export function sanitizeGraphicsSettings(value: unknown): GraphicsSettings {
  const saved = value && typeof value === 'object' ? value as Partial<GraphicsSettings> & Partial<LegacyGameSettings> : {};
  const legacy = !('ocean' in saved) && typeof saved.quality === 'string' ? saved as Partial<LegacyGameSettings> : undefined;
  const base: GraphicsSettings = legacy ? { ...GRAPHICS_PRESETS[oneOf(legacy.quality, ['medium', 'high', 'ultra'], 'high')] } : { ...DEFAULT_GRAPHICS };
  if (legacy) return { ...base, renderScale: sanitizeRenderScale(typeof legacy.resolution === 'number' ? legacy.resolution * 100 : undefined, base.renderScale) };
  return {
    renderScale: sanitizeRenderScale(saved.renderScale, base.renderScale),
    frameLimit: FRAME_LIMITS.includes(saved.frameLimit as FrameLimit) ? saved.frameLimit as FrameLimit : base.frameLimit,
    antialiasing: oneOf(saved.antialiasing, ['off', 'fxaa', 'smaa'], base.antialiasing),
    ocean: oneOf(saved.ocean, ['low', 'medium', 'high', 'ultra'], base.ocean),
    reflections: oneOf(saved.reflections, ['sky', 'scene'], base.reflections),
    clouds: oneOf(saved.clouds, ['low', 'medium', 'high', 'ultra'], base.clouds),
    shadows: oneOf(saved.shadows, ['off', 'low', 'medium', 'high'], base.shadows),
    modelDetail: oneOf(saved.modelDetail, ['low', 'medium', 'high', 'full'], base.modelDetail),
    terrain: oneOf(saved.terrain, ['medium', 'high'], base.terrain),
    effects: oneOf(saved.effects, ['low', 'medium', 'high'], base.effects),
    readout: oneOf(saved.readout, ['hidden', 'fps', 'detailed'], base.readout),
  };
}

/** The new key wins; the legacy key migrates a saved tier and render scale once. */
export function loadGraphicsSettings(): GraphicsSettings {
  try {
    const current = localStorage.getItem(GRAPHICS_STORAGE_KEY);
    if (current) return sanitizeGraphicsSettings(JSON.parse(current));
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    return legacy ? sanitizeGraphicsSettings(JSON.parse(legacy)) : { ...DEFAULT_GRAPHICS };
  } catch { return { ...DEFAULT_GRAPHICS }; }
}

const SETTING_KEYS = Object.keys(DEFAULT_GRAPHICS) as (keyof GraphicsSettings)[];

export function matchingPreset(settings: GraphicsSettings): GraphicsPreset | null {
  return PRESET_ORDER.find(name => SETTING_KEYS.every(key => GRAPHICS_PRESETS[name][key] === settings[key])) ?? null;
}

/** The preset sharing the most rows; ties favor the higher tier. */
export function nearestPreset(settings: GraphicsSettings): GraphicsPreset {
  let best: GraphicsPreset = 'high', score = -1;
  for (const name of PRESET_ORDER) {
    const shared = SETTING_KEYS.filter(key => GRAPHICS_PRESETS[name][key] === settings[key]).length;
    if (shared >= score) { score = shared; best = name; }
  }
  return best;
}

/** Sun shadow map edge in texels; 0 disables the sun's shadow pass. */
export function shadowMapSize(shadows: ShadowQuality): number {
  return shadows === 'off' ? 0 : shadows === 'low' ? 1024 : shadows === 'medium' ? 2048 : 4096;
}

/** Projected surface error, in framebuffer pixels, a reduced ship level may show. */
export function shipDetailBudgetPx(detail: ModelDetail): number {
  return detail === 'low' ? 3 : detail === 'medium' ? 2 : detail === 'high' ? 1.25 : .5;
}

/** Multiplier on the wingspan thresholds that keep a full-detail airframe. */
export function aircraftDetailScale(detail: ModelDetail): number {
  return shipDetailBudgetPx(detail) / shipDetailBudgetPx('high');
}

/** Fraction of combat particles and funnel smoke that is emitted. */
export function effectsDensity(effects: EffectsQuality): number {
  return effects === 'low' ? .5 : effects === 'medium' ? .75 : 1;
}

/** Sky Pro tier plus the reflection bake budget the game keeps below each tier's default. */
export function cloudTier(clouds: CloudQuality): { level: CloudQuality; envMapWidth: number; envMapMarchSteps: number } {
  const bake = { low: [256, 12], medium: [384, 16], high: [512, 24], ultra: [768, 32] }[clouds];
  return { level: clouds, envMapWidth: bake[0], envMapMarchSteps: bake[1] };
}

/** Milliseconds between rendered frames; 0 renders every display refresh. */
export function frameIntervalMs(limit: FrameLimit): number { return limit ? 1000 / limit : 0; }

/** Whether the loaded scene already uses the rows that only apply at launch. */
export function launchMatches(launched: Pick<GraphicsSettings, 'ocean' | 'terrain'>, current: GraphicsSettings): boolean {
  return launched.ocean === current.ocean && launched.terrain === current.terrain;
}
