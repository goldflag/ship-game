export type GraphicsPreset = 'low' | 'medium' | 'high' | 'ultra';
export type OceanQuality = 'low' | 'medium' | 'high' | 'ultra';
export type CloudQuality = 'low' | 'medium' | 'high' | 'ultra';
export type ShadowQuality = 'off' | 'low' | 'medium' | 'high';
export type WaterShadowQuality = 'off' | 'low' | 'medium' | 'high';
export type ModelDetail = 'low' | 'medium' | 'high' | 'full';
export type TerrainQuality = 'medium' | 'high';
export type EffectsQuality = 'low' | 'medium' | 'high';
export type Antialiasing = 'off' | 'fxaa' | 'smaa' | 'taa';
export type Bloom = 'off' | 'on';
export type AmbientOcclusion = 'off' | 'low' | 'high';
export type Reflections = 'sky' | 'scene';
export type PerformanceReadoutMode = 'hidden' | 'fps' | 'detailed';
/** Which sky draws the scene: the game's own, or the vendored Sky Pro library it replaced, kept to compare them. */
export type SkyRenderer = 'game' | 'skypro';
/** Frames per second; 0 follows the display refresh. */
export type FrameLimit = 0 | 30 | 60 | 120;

export interface GraphicsSettings {
  /** Percent of the capped device resolution, 50–100 in steps of 5. */
  renderScale: number;
  frameLimit: FrameLimit;
  antialiasing: Antialiasing;
  /** Glow on HDR highlights ahead of tone mapping. Applies live. */
  bloom: Bloom;
  /** Ocean tier (see src/game/ocean/quality.ts); applies when the port next loads. */
  ocean: OceanQuality;
  reflections: Reflections;
  clouds: CloudQuality;
  shadows: ShadowQuality;
  /** Ship-on-ship occlusion of sky and fill light; see ShipOcclusion. Applies live. */
  ambientOcclusion: AmbientOcclusion;
  /** Filtering of ship shadows on the sea; requires scene shadows. Applies live. */
  waterShadows: WaterShadowQuality;
  modelDetail: ModelDetail;
  /** Harbor and island mesh density; applies when the port next loads or the next battle starts. */
  terrain: TerrainQuality;
  effects: EffectsQuality;
  readout: PerformanceReadoutMode;
  /** Developer comparison (the console's "Switch sky renderer"), not a quality row: presets keep it and never
   * match on it. Applies when the port next loads. */
  skyRenderer: SkyRenderer;
}

export const GRAPHICS_STORAGE_KEY = 'fleet-graphics-settings';
export const RENDER_SCALE_MIN = 50;
export const RENDER_SCALE_STEP = 5;
export const FRAME_LIMITS: readonly FrameLimit[] = [0, 120, 60, 30];

/** High reproduces the ocean, sky, shadow and terrain choices of the former High tier exactly. */
const QUALITY: Readonly<Record<GraphicsPreset, Omit<GraphicsSettings, 'skyRenderer'>>> = {
  low: { renderScale: 75, frameLimit: 0, antialiasing: 'fxaa', bloom: 'off', ocean: 'low', reflections: 'sky', clouds: 'low', shadows: 'off', ambientOcclusion: 'off', waterShadows: 'off', modelDetail: 'low', terrain: 'medium', effects: 'low', readout: 'fps' },
  medium: { renderScale: 100, frameLimit: 0, antialiasing: 'fxaa', bloom: 'on', ocean: 'medium', reflections: 'sky', clouds: 'medium', shadows: 'low', ambientOcclusion: 'off', waterShadows: 'low', modelDetail: 'medium', terrain: 'medium', effects: 'medium', readout: 'fps' },
  high: { renderScale: 100, frameLimit: 0, antialiasing: 'fxaa', bloom: 'on', ocean: 'high', reflections: 'scene', clouds: 'medium', shadows: 'medium', ambientOcclusion: 'low', waterShadows: 'high', modelDetail: 'high', terrain: 'high', effects: 'high', readout: 'fps' },
  ultra: { renderScale: 100, frameLimit: 0, antialiasing: 'smaa', bloom: 'on', ocean: 'ultra', reflections: 'scene', clouds: 'high', shadows: 'high', ambientOcclusion: 'high', waterShadows: 'high', modelDetail: 'full', terrain: 'high', effects: 'high', readout: 'fps' },
};
/** Presets set the quality rows only and draw the game's own sky. */
export const GRAPHICS_PRESETS: Readonly<Record<GraphicsPreset, Readonly<GraphicsSettings>>> = {
  low: { ...QUALITY.low, skyRenderer: 'game' }, medium: { ...QUALITY.medium, skyRenderer: 'game' },
  high: { ...QUALITY.high, skyRenderer: 'game' }, ultra: { ...QUALITY.ultra, skyRenderer: 'game' },
};
export const PRESET_ORDER: readonly GraphicsPreset[] = ['low', 'medium', 'high', 'ultra'];
export const DEFAULT_GRAPHICS: Readonly<GraphicsSettings> = GRAPHICS_PRESETS.high;

const oneOf = <T extends string>(value: unknown, choices: readonly T[], fallback: T): T => choices.includes(value as T) ? value as T : fallback;

export function sanitizeRenderScale(value: unknown, fallback = DEFAULT_GRAPHICS.renderScale): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const stepped = Math.round(value / RENDER_SCALE_STEP) * RENDER_SCALE_STEP;
  return Math.max(RENDER_SCALE_MIN, Math.min(100, stepped));
}

/** Accepts the current shape or garbage. */
export function sanitizeGraphicsSettings(value: unknown): GraphicsSettings {
  const saved = value && typeof value === 'object' ? value as Partial<GraphicsSettings> : {};
  const base: GraphicsSettings = { ...DEFAULT_GRAPHICS };
  // Older saves inherit the water tier associated with their shadow budget.
  const inheritedWater = saved.shadows === 'off' ? 'off' : saved.shadows === 'low' ? 'low' : base.waterShadows;
  const settings: GraphicsSettings = {
    renderScale: sanitizeRenderScale(saved.renderScale, base.renderScale),
    frameLimit: FRAME_LIMITS.includes(saved.frameLimit as FrameLimit) ? saved.frameLimit as FrameLimit : base.frameLimit,
    antialiasing: oneOf(saved.antialiasing, ['off', 'fxaa', 'smaa', 'taa'], base.antialiasing),
    bloom: oneOf(saved.bloom, ['off', 'on'], base.bloom),
    ocean: oneOf(saved.ocean, ['low', 'medium', 'high', 'ultra'], base.ocean),
    reflections: oneOf(saved.reflections, ['sky', 'scene'], base.reflections),
    clouds: oneOf(saved.clouds, ['low', 'medium', 'high', 'ultra'], base.clouds),
    shadows: oneOf(saved.shadows, ['off', 'low', 'medium', 'high'], base.shadows),
    ambientOcclusion: oneOf(saved.ambientOcclusion, ['off', 'low', 'high'], base.ambientOcclusion),
    waterShadows: oneOf(saved.waterShadows, ['off', 'low', 'medium', 'high'], saved.waterShadows === undefined ? inheritedWater : base.waterShadows),
    modelDetail: oneOf(saved.modelDetail, ['low', 'medium', 'high', 'full'], base.modelDetail),
    terrain: oneOf(saved.terrain, ['medium', 'high'], base.terrain),
    effects: oneOf(saved.effects, ['low', 'medium', 'high'], base.effects),
    readout: oneOf(saved.readout, ['hidden', 'fps', 'detailed'], base.readout),
    skyRenderer: oneOf(saved.skyRenderer, ['game', 'skypro'], base.skyRenderer),
  };
  // Saves from before a row take it from the preset they otherwise sit closest to,
  // so a saved preset still reads as that preset.
  const unset = (['ambientOcclusion', 'bloom'] as const).filter(key => saved[key] === undefined);
  if (unset.length) {
    const preset = GRAPHICS_PRESETS[nearestPreset(settings, unset)];
    if (unset.includes('ambientOcclusion')) settings.ambientOcclusion = preset.ambientOcclusion;
    if (unset.includes('bloom')) settings.bloom = preset.bloom;
  }
  return settings;
}

export function loadGraphicsSettings(): GraphicsSettings {
  try {
    const current = localStorage.getItem(GRAPHICS_STORAGE_KEY);
    return current ? sanitizeGraphicsSettings(JSON.parse(current)) : { ...DEFAULT_GRAPHICS };
  } catch { return { ...DEFAULT_GRAPHICS }; }
}

/** The quality rows presets set and match; the developer sky comparison is not one of them. */
const SETTING_KEYS = (Object.keys(DEFAULT_GRAPHICS) as (keyof GraphicsSettings)[]).filter(key => key !== 'skyRenderer');

/** A quality preset applied over the current settings, keeping the developer sky comparison. */
export function withPreset(current: Pick<GraphicsSettings, 'skyRenderer'>, preset: GraphicsPreset): GraphicsSettings {
  return { ...GRAPHICS_PRESETS[preset], skyRenderer: current.skyRenderer };
}

export function matchingPreset(settings: GraphicsSettings): GraphicsPreset | null {
  return PRESET_ORDER.find(name => SETTING_KEYS.every(key => GRAPHICS_PRESETS[name][key] === settings[key])) ?? null;
}

/** The preset sharing the most rows, apart from `ignore`; ties favor the higher tier. */
export function nearestPreset(settings: GraphicsSettings, ignore: readonly (keyof GraphicsSettings)[] = []): GraphicsPreset {
  let best: GraphicsPreset = 'high', score = -1;
  for (const name of PRESET_ORDER) {
    const shared = SETTING_KEYS.filter(key => !ignore.includes(key) && GRAPHICS_PRESETS[name][key] === settings[key]).length;
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

/** Milliseconds between rendered frames; 0 renders every display refresh. */
export function frameIntervalMs(limit: FrameLimit): number { return limit ? 1000 / limit : 0; }

/** The rows a scene is built with; changing one rebuilds the port. */
export type LaunchedGraphics = Pick<GraphicsSettings, 'ocean' | 'terrain' | 'skyRenderer'>;

/** Whether the loaded scene already uses the rows that only apply at launch. */
export function launchMatches(launched: LaunchedGraphics, current: GraphicsSettings): boolean {
  return launched.ocean === current.ocean && launched.terrain === current.terrain && launched.skyRenderer === current.skyRenderer;
}
