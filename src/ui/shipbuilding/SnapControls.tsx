import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SNAP_STEPS, type BuilderTool } from './builderTool';
import type { SnapSettings } from './snapping';
import { ToolGlyph } from './builderGlyphs';
import { VERTEX_UNITS } from '../../ships/constructionVertex';

export function SnapControls({ tool, locked }: { tool: BuilderTool; locked: boolean }) {
  const [position, setPosition] = useState<{ left: number; top: number }>();
  const trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null), id = useId();
  const state = tool.getSnapshot(), settings = state.snapping, effective = tool.effectiveSnapping.enabled;
  const step = tool.freeformMode ? state.freeformSettings.unit : tool.gridStep;
  useEffect(() => {
    if (!position) return;
    panel.current?.querySelector<HTMLElement>('input')?.focus();
    const outside = (e: PointerEvent) => { if (!panel.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) setPosition(undefined); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); setPosition(undefined); trigger.current?.focus(); } };
    const close = () => setPosition(undefined);
    window.addEventListener('pointerdown', outside); window.addEventListener('keydown', key, true); window.addEventListener('resize', close);
    return () => { window.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', key, true); window.removeEventListener('resize', close); };
  }, [!!position]);
  const toggle = (key: keyof SnapSettings, label: string) => <label><input type="checkbox" checked={settings[key]} disabled={locked} onChange={e => tool.changeSnapping({ [key]: e.target.checked })}/><span>{label}</span></label>;
  return <div className="sb-snap-control" data-override={state.snapOverride || undefined}>
    <button className="toggle sb-snap-main" disabled={locked} aria-pressed={effective} aria-label={`Snapping ${effective ? 'on' : 'off'}`} title="N toggles snapping; hold Alt/Option to temporarily invert it" onClick={tool.toggleSnapping}>
      <ToolGlyph name="Snap"/><span>Snap {effective ? 'on' : 'off'}</span><kbd>N</kbd>
    </button>
    <button ref={trigger} className="sb-snap-options" aria-label="Snap settings" aria-expanded={!!position} aria-controls={position ? id : undefined} disabled={locked} onClick={() => {
      const rect = trigger.current!.getBoundingClientRect();
      setPosition(position ? undefined : { left: Math.max(8, Math.min(rect.right + 8, window.innerWidth - 248)), top: Math.max(8, Math.min(rect.top - 120, window.innerHeight - 340)) });
    }}><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 8 4 4 4-4"/></svg></button>
    <button className="sb-snap-step-cycle" disabled={locked} aria-label={`Grid spacing ${step} m; cycle with S`} title={`${tool.freeformMode ? 'Local move step' : 'Grid spacing'}: ${step} m · S to cycle`} onClick={tool.cycleGrid}><span>{step} m</span><kbd>S</kbd></button>
    {position && createPortal(<div className="shipbuilder sb-snap-popover" id={id} ref={panel} role="group" aria-label="Snap settings" style={position}>
      <strong>Snap to</strong>
      {toggle('grid', 'Grid')}
      <div className="sb-snap-step"><span>{tool.freeformMode ? 'Local move step' : 'Grid spacing'} · m</span><div role="group" aria-label="Grid spacing" className="sb-snap-steps">
        {(tool.freeformMode ? VERTEX_UNITS : SNAP_STEPS).map(value => <button key={value} aria-pressed={step === value} aria-label={`${value} m`} disabled={locked} onClick={() => tool.freeformMode ? tool.changeFreeformSettings({ unit: value }) : tool.setSnapStep(value)}>{value}</button>)}
      </div></div>
      {toggle('centerline', 'Ship centerline')}
      {toggle('geometry', 'Nearby edges, corners & centers')}
      <strong>Show</strong>
      {toggle('guides', 'Alignment guides')}
      {toggle('showCenterline', 'Centerline when dragging nearby')}
      <p><kbd>N</kbd> toggle · <kbd>S</kbd> cycle grid<br/>Hold <kbd>Alt / Option</kbd> to invert snapping</p>
    </div>, document.body)}
  </div>;
}
