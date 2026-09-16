import { ToolGlyph } from './builderGlyphs';
import type { BuilderView } from './BuilderViewport';

/** The view bar's presentation. `text` is the standing label · value · key row; the others are the compact studies. */
export type ViewBarVariant = 'text' | 'icons' | 'captions' | 'chips' | 'column';

export interface ViewBarTip { title: string; detail: string; key?: string; target: HTMLElement }
export interface ViewBarProps {
  variant: ViewBarVariant;
  viewName: string; view: BuilderView; perspective: boolean; sliceLabel: string; sliceOn: boolean; showCenters: boolean; snapLabel: string; mirror: boolean;
  onView(): void; onProjection(): void; onSlice(): void; onCenters(): void; onMirror(): void; onFit(): void;
  onTip(tip: ViewBarTip | undefined): void;
}

interface Entry { id: string; glyph: string; label: string; value?: string; short?: string; pressed?: boolean; key?: string; detail: string; group: number; onClick?(): void }

export function ViewBar(props: ViewBarProps) {
  const { variant, onTip } = props;
  const entries: Entry[] = [
    { id: 'view', glyph: 'View', label: 'View', value: props.viewName, short: props.viewName, key: 'Q', detail: 'Cycle the view', group: 0, onClick: props.onView },
    { id: 'camera', glyph: props.perspective ? 'Perspective' : 'Orthographic', label: 'Camera', value: props.perspective ? 'Perspective' : 'Orthographic', short: props.perspective ? 'Persp' : 'Ortho', key: 'P', detail: 'Toggle orthographic and perspective cameras', group: 0, onClick: props.onProjection },
    { id: 'slice', glyph: 'Slice', label: 'Slice', value: props.sliceLabel, short: props.sliceLabel, pressed: props.sliceOn, key: 'S', detail: 'Cut the ship above a height', group: 0, onClick: props.onSlice },
    { id: 'centers', glyph: 'Centers', label: 'Centers', value: props.showCenters ? 'On' : 'Off', short: props.showCenters ? 'On' : 'Off', pressed: props.showCenters, key: 'C', detail: 'Show center of gravity (mass) and center of buoyancy markers', group: 1, onClick: props.onCenters },
    { id: 'snap', glyph: 'Snap', label: 'Snap', value: props.snapLabel, short: props.snapLabel, detail: 'Placement snaps to the face under the pointer', group: 1 },
    { id: 'mirror', glyph: 'Mirror', label: 'Mirror', value: props.mirror ? 'On' : 'Off', short: props.mirror ? 'On' : 'Off', pressed: props.mirror, key: 'M', detail: 'Mirror placements across the centerline', group: 1, onClick: props.onMirror },
    { id: 'fit', glyph: 'Fit', label: 'Fit', key: 'Home', detail: 'Frame the ship', group: 2, onClick: props.onFit },
  ];
  const title = (entry: Entry) => `${entry.label}${entry.value ? ` · ${entry.value}` : ''}`;
  const hover = (entry: Entry) => ({
    onPointerEnter: (event: React.PointerEvent<HTMLElement>) => onTip({ title: title(entry), detail: entry.detail, key: entry.key, target: event.currentTarget }),
    onPointerLeave: () => onTip(undefined),
    onFocus: (event: React.FocusEvent<HTMLElement>) => onTip({ title: title(entry), detail: entry.detail, key: entry.key, target: event.currentTarget }),
    onBlur: () => onTip(undefined),
  });

  if (variant === 'text') return <div className="sb-viewbar text">
    {entries.map(entry => entry.onClick
      ? <button key={entry.id} aria-pressed={entry.pressed} onClick={entry.onClick} title={`${entry.detail} (${entry.key})`}>{entry.label}{entry.value && <> <b>{entry.value}</b></>}<kbd>{entry.key}</kbd></button>
      : <span key={entry.id} title={entry.detail}>{entry.label} <b>{entry.value}</b></span>)}
  </div>;

  if (variant === 'chips') return <div className="sb-viewbar chips">
    {entries.map(entry => entry.onClick
      ? <button key={entry.id} className="sb-vb-chip" aria-pressed={entry.pressed} onClick={() => { entry.onClick!(); }} {...hover(entry)}><kbd>{entry.key}</kbd>{entry.value ? <b>{entry.value}</b> : entry.label}</button>
      : <span key={entry.id} className="sb-vb-chip" {...hover(entry)}><ToolGlyph name={entry.glyph}/><b>{entry.value}</b></span>)}
  </div>;

  // icon variants: a square per control, grouped view · camera · slice | centers · snap · mirror | fit
  const face = (entry: Entry) => <><ToolGlyph name={entry.glyph}/>{variant !== 'icons' && <small>{entry.short ?? entry.label}</small>}</>;
  return <div className={`sb-viewbar ${variant}`}>
    {entries.map((entry, index) => {
      const gap = index > 0 && entries[index - 1].group !== entry.group;
      const className = `sb-vb ${gap ? 'gap' : ''}`;
      return entry.onClick
        ? <button key={entry.id} className={className} aria-pressed={entry.pressed} aria-label={title(entry)} onClick={entry.onClick} {...hover(entry)}>{face(entry)}</button>
        : <span key={entry.id} className={`${className} static`} aria-label={title(entry)} {...hover(entry)}>{face(entry)}</span>;
    })}
  </div>;
}
