export const SCHEMATIC_OPTIONS = {
  layout: { standard: 'Standard', fourView: 'Four views', showcase: 'Showcase' },
  stock: { light: 'Light', charcoal: 'Charcoal', ink: 'Ink' },
  units: { metric: 'Metric', imperial: 'Imperial' },
  page: { hd: 'HD · 2560 × 1440', uhd: '4K · 3840 × 2160' },
  format: { png: 'PNG', webp: 'WebP' },
} as const;

export type SchematicChoices = { [K in keyof typeof SCHEMATIC_OPTIONS]: keyof typeof SCHEMATIC_OPTIONS[K] };
export type DrawingChoices = Omit<SchematicChoices, 'format'>;
export const SCHEMATIC_DEFAULTS: SchematicChoices = {
  layout: 'standard', stock: 'light', units: 'metric', page: 'hd', format: 'png',
};
export const SCHEMATIC_PAGES = { hd: { width: 2560, height: 1440 }, uhd: { width: 3840, height: 2160 } };
export const SCHEMATIC_STORAGE_KEY = 'bismarck-schematic';

export function schematicChoicesOf(value: unknown): SchematicChoices {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const pick = <K extends keyof SchematicChoices>(key: K): SchematicChoices[K] => {
    const candidate = source[key];
    return typeof candidate === 'string' && Object.hasOwn(SCHEMATIC_OPTIONS[key], candidate)
      ? candidate as SchematicChoices[K] : SCHEMATIC_DEFAULTS[key];
  };
  return { layout: pick('layout'), stock: pick('stock'), units: pick('units'), page: pick('page'), format: pick('format') };
}

// File format only changes encoding; it must never rebuild the drawing or the ship.
export function schematicDrawingKey(choices: DrawingChoices): string {
  return [choices.layout, choices.stock, choices.units, choices.page].join('/');
}

export function formatLength(meters: number, units: SchematicChoices['units']): string {
  return `${(units === 'metric' ? meters : meters / 0.3048).toFixed(1)} ${units === 'metric' ? 'm' : 'ft'}`;
}

export function schematicFileName(choices: SchematicChoices): string {
  return `bismarck-schematic-${choices.layout}-${choices.stock}-${choices.units}-${choices.page}.${choices.format}`;
}
