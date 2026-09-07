export interface HudSettings { mode: 'auto' | 'manual'; scale: number; }
export const HUD_STORAGE_KEY = 'fleet-hud-settings';
export const DEFAULT_HUD: HudSettings = { mode: 'auto', scale: 1 };

export function sanitizeHudSettings(value: unknown): HudSettings {
  const saved = value && typeof value === 'object' ? value as Partial<HudSettings> : {};
  return {
    mode: saved.mode === 'manual' ? 'manual' : 'auto',
    scale: typeof saved.scale === 'number' && Number.isFinite(saved.scale) ? Math.max(.5, Math.min(2, saved.scale)) : 1,
  };
}

export function loadHudSettings(): HudSettings {
  try { return sanitizeHudSettings(JSON.parse(localStorage.getItem(HUD_STORAGE_KEY) ?? 'null')); }
  catch { return { ...DEFAULT_HUD }; }
}

/** CSS viewport pixels already account for OS/Retina scaling. Never multiply by DPR.
 * Fit against a 1080p workspace; width limits narrow windows and height limits ultrawides.
 */
export function hudScaleFor(settings: HudSettings, width: number, height: number): number {
  const { mode, scale } = sanitizeHudSettings(settings);
  const validViewport = Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0;
  const automatic = validViewport ? Math.max(.75, Math.min(2, width / 1920, height / 1080)) : 1;
  return Math.max(.5, Math.min(3, (mode === 'auto' ? automatic : 1) * scale));
}
