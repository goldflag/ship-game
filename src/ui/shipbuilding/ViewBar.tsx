import { ToolGlyph } from './builderGlyphs';

export interface ViewBarTip { title: string; detail: string; key?: string; target: HTMLElement }
export interface ViewBarProps {
  viewName: string; perspective: boolean; sliceLabel: string; sliceOn: boolean; showCenters: boolean; snapLabel: string; mirror: boolean;
  onSnap(): void; onView(): void; onProjection(): void; onSlice(): void; onCenters(): void; onMirror(): void; onFit(): void;
  onTip(tip: ViewBarTip | undefined): void;
}

interface Entry { id: string; glyph: string; label: string; value?: string; pressed?: boolean; key?: string; detail: string; group: number; onClick?(): void }

/** View bar at the palette's right end: an icon square per control in three groups (view · camera · slice | centers · snap · mirror | fit).
 *  Toggles show their state as the pressed card; the name, value, description and key appear in the tooltip. */
export function ViewBar(props: ViewBarProps) {
  const { onTip } = props;
  const entries: Entry[] = [
    { id: 'view', glyph: 'View', label: 'View', value: props.viewName, key: 'Q', detail: 'Cycle the view', group: 0, onClick: props.onView },
    { id: 'camera', glyph: props.perspective ? 'Perspective' : 'Orthographic', label: 'Camera', value: props.perspective ? 'Perspective' : 'Orthographic', key: 'P', detail: 'Toggle orthographic and perspective cameras', group: 0, onClick: props.onProjection },
    { id: 'slice', glyph: 'Slice', label: 'Slice', value: props.sliceLabel, pressed: props.sliceOn, key: 'S', detail: 'Cut the ship above a height', group: 0, onClick: props.onSlice },
    { id: 'centers', glyph: 'Centers', label: 'Centers', value: props.showCenters ? 'On' : 'Off', pressed: props.showCenters, key: 'C', detail: 'Show center of gravity (mass) and center of buoyancy markers', group: 1, onClick: props.onCenters },
    { id: 'snap', glyph: 'Snap', label: 'Snap', value: props.snapLabel, detail: 'Click to cycle 0.25, 0.5, 1, 2 and 5 m. Applies to placement and movement.', group: 1, onClick: props.onSnap },
    { id: 'mirror', glyph: 'Mirror', label: 'Mirror', value: props.mirror ? 'On' : 'Off', pressed: props.mirror, key: 'M', detail: 'Mirror placements across the centerline', group: 1, onClick: props.onMirror },
    { id: 'fit', glyph: 'Fit', label: 'Fit', key: 'Home', detail: 'Frame the ship', group: 2, onClick: props.onFit },
  ];
  const title = (entry: Entry) => `${entry.label}${entry.value ? ` · ${entry.value}` : ''}`;
  const show = (entry: Entry, target: HTMLElement) => onTip({ title: title(entry), detail: entry.detail, key: entry.key, target });
  return <div className="sb-viewbar">
    {entries.map((entry, index) => {
      const className = `sb-vb ${index > 0 && entries[index - 1].group !== entry.group ? 'gap' : ''}`;
      const hover = { onPointerEnter: (event: React.PointerEvent<HTMLElement>) => show(entry, event.currentTarget), onPointerLeave: () => onTip(undefined), onFocus: (event: React.FocusEvent<HTMLElement>) => show(entry, event.currentTarget), onBlur: () => onTip(undefined) };
      return entry.onClick
        ? <button key={entry.id} className={className} aria-pressed={entry.pressed} aria-label={title(entry)} onClick={entry.onClick} {...hover}>{entry.id === 'snap' ? <span className="sb-snap-value">{props.snapLabel}</span> : <ToolGlyph name={entry.glyph}/>}</button>
        : <span key={entry.id} className={`${className} static`} aria-label={title(entry)} {...hover}><ToolGlyph name={entry.glyph}/></span>;
    })}
  </div>;
}
