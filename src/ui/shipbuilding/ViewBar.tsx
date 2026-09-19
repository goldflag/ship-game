import { ToolGlyph } from './builderGlyphs';

export interface ViewBarTip { title: string; detail: string; key?: string; target: HTMLElement }
export interface ViewBarProps {
  viewName: string; perspective: boolean; showCenters: boolean;
  /** Undefined outside the fitting tabs, where arcs never draw; the Arcs square then stays off the strip. */
  showArcs?: boolean;
  onView(): void; onProjection(): void; onCenters(): void; onArcs(): void; onFit(): void;
  onTip(tip: ViewBarTip | undefined): void;
}

interface Entry { id: string; glyph: string; label: string; value?: string; pressed?: boolean; key?: string; detail: string; group: number; onClick(): void }

/** View strip inside the tool rail, under the modifiers: how the ship is shown, never what a click does. Bare glyph cells
 *  (view · camera · fit, then centers · arcs) in the rail's single column. Toggles show their state as the pressed cell;
 *  the name, value, description and key appear in the tooltip beside the glyph. */
export function ViewBar(props: ViewBarProps) {
  const { onTip } = props;
  const entries: Entry[] = [
    { id: 'view', glyph: 'View', label: 'View', value: props.viewName, key: 'Q', detail: 'Cycle the view', group: 0, onClick: props.onView },
    { id: 'camera', glyph: props.perspective ? 'Perspective' : 'Orthographic', label: 'Camera', value: props.perspective ? 'Perspective' : 'Orthographic', key: 'P', detail: 'Toggle orthographic and perspective cameras', group: 0, onClick: props.onProjection },
    { id: 'fit', glyph: 'Fit', label: 'Fit', key: 'Home', detail: 'Frame the ship', group: 0, onClick: props.onFit },
    { id: 'centers', glyph: 'Centers', label: 'Centers', value: props.showCenters ? 'On' : 'Off', pressed: props.showCenters, key: 'C', detail: 'Show center of gravity (mass) and center of buoyancy markers', group: 1, onClick: props.onCenters },
    ...(props.showArcs === undefined ? [] : [{ id: 'arcs', glyph: 'Arc', label: 'Arcs', value: props.showArcs ? 'On' : 'Off', pressed: props.showArcs, key: 'A', detail: 'Show the traverse arc of every gun mount', group: 1, onClick: props.onArcs }]),
  ];
  const title = (entry: Entry) => `${entry.label}${entry.value ? ` · ${entry.value}` : ''}`;
  const show = (entry: Entry, target: HTMLElement) => onTip({ title: title(entry), detail: entry.detail, key: entry.key, target });
  return <div className="sb-viewbar" role="toolbar" aria-label="View">
    {entries.map((entry, index) => <button key={entry.id} className={`sb-vb ${index > 0 && entries[index - 1].group !== entry.group ? 'gap' : ''}`} aria-pressed={entry.pressed} aria-label={title(entry)} onClick={entry.onClick}
      onPointerEnter={event => show(entry, event.currentTarget)} onPointerLeave={() => onTip(undefined)} onFocus={event => show(entry, event.currentTarget)} onBlur={() => onTip(undefined)}><ToolGlyph name={entry.glyph}/></button>)}
  </div>;
}
