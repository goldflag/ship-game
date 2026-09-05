import type { DrawingChoices } from './options';

export type View = 'side' | 'plan' | 'front' | 'rear' | 'hero';
export type Span = { width: number; height: number; centerRight: number; centerUp: number; near: number; far: number };
export type Rect = { x: number; y: number; width: number; height: number };
export const ORTHOGRAPHIC_VIEWS = ['side', 'plan', 'front', 'rear'] as const;

// Logical sheet coordinates; the whole composition scales together for HD and 4K.
export function layOutSchematic(spans: Record<View, Span>, layout: DrawingChoices['layout']) {
  const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });
  const views: Partial<Record<View, Rect>> = layout === 'showcase'
    ? { hero: rect(75, 135, 1120, 620) }
    : layout === 'fourView'
      ? {
        side: rect(75, 145, 910, 260), front: rect(1030, 145, 160, 260),
        plan: rect(75, 525, 910, 180), rear: rect(1030, 470, 160, 260),
      }
      : {
        side: rect(75, 90, 910, 230), front: rect(1030, 90, 160, 230),
        plan: rect(75, 387, 910, 150), rear: rect(1030, 380, 160, 230),
        hero: rect(75, 625, 910, 190),
      };
  let metersPerPixel = 0;
  for (const key of ORTHOGRAPHIC_VIEWS) {
    const box = views[key];
    if (box) metersPerPixel = Math.max(metersPerPixel, spans[key].width / box.width, spans[key].height / box.height);
  }
  return { views, metersPerPixel: metersPerPixel * 1.08 };
}
