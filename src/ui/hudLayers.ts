/**
 * The DOM layers that follow the HUD scale setting: the one list to edit when adding one.
 *
 * Each entry is keyed by the `Game` field that owns the layer.
 * - `className` is the root element's class; the layer's constructor reads it from here.
 * - `host` says where the root is appended: `viewport` layers live inside `.ocean-viewport`
 *   beside the canvas, `shell` layers are direct children of `.game-shell`.
 * - `projected` layers place marks from camera projections, so `Game.setHudScale` resizes
 *   them to the scaled logical viewport. Unprojected layers are scaled by CSS alone.
 *
 * Adding a layer:
 * 1. Add its entry here and a `Game` field of the same name (`Game.resizeHudOverlays`
 *    and the frame test harness iterate this list, so both follow automatically).
 * 2. Add its class to the `--hud-scale` rule in `src/ui/styles.css`. `hudLayers.test.ts`
 *    fails with the expected selector until the rule and this list agree.
 */
export const HUD_LAYERS = {
  shipLabels: { className: 'ship-label-layer', host: 'viewport', projected: true },
  gunAim: { className: 'gun-aim-layer', host: 'viewport', projected: true },
  torpedoAim: { className: 'torpedo-aim-layer', host: 'viewport', projected: true },
  torpedoMarkers: { className: 'torpedo-marker-layer', host: 'viewport', projected: true },
  hitDirections: { className: 'hit-direction-layer', host: 'shell', projected: false },
} as const satisfies Record<string, { className: string; host: 'viewport' | 'shell'; projected: boolean }>;

export type HudLayerField = keyof typeof HUD_LAYERS;
export type ProjectedHudLayerField = { [K in HudLayerField]: (typeof HUD_LAYERS)[K]['projected'] extends true ? K : never }[HudLayerField];

export const HUD_LAYER_FIELDS = Object.keys(HUD_LAYERS) as HudLayerField[];
/** The layers `Game.setHudScale` resizes, in declaration order. */
export const PROJECTED_HUD_LAYER_FIELDS = HUD_LAYER_FIELDS.filter((field): field is ProjectedHudLayerField => HUD_LAYERS[field].projected);

/** The selector the `--hud-scale` rule in `src/ui/styles.css` must carry, React's `.hud-viewport` included. */
export function hudScaleSelector(): string {
  const classes = (host: 'viewport' | 'shell') =>
    HUD_LAYER_FIELDS.filter((field) => HUD_LAYERS[field].host === host).map((field) => `.${HUD_LAYERS[field].className}`);
  return [
    '.hud-viewport',
    `.ocean-viewport :is(${classes('viewport').join(', ')})`,
    ...classes('shell').map((name) => `.game-shell > ${name}`),
  ].join(', ');
}
