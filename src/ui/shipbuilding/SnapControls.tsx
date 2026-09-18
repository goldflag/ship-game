import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
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
  const overrideHint = state.snapOverride ? 'Release Alt/Option to restore snapping' : `Hold Alt/Option to ${effective ? 'release' : 'enable'} snapping`;
  useLayoutEffect(() => {
    if (!position || !panel.current) return;
    const rect = panel.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(position.left, window.innerWidth - rect.width - 8));
    const top = Math.max(8, Math.min(position.top, window.innerHeight - rect.height - 8));
    if (left !== position.left || top !== position.top) setPosition({ left, top });
  }, [position, effective, state.snapOverride]);
  useEffect(() => {
    if (!position) return;
    panel.current?.querySelector<HTMLElement>('input')?.focus();
    const outside = (e: PointerEvent) => { if (!panel.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) setPosition(undefined); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); setPosition(undefined); trigger.current?.focus(); } };
    const close = () => setPosition(undefined);
    window.addEventListener('pointerdown', outside); window.addEventListener('keydown', key, true); window.addEventListener('resize', close);
    return () => { window.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', key, true); window.removeEventListener('resize', close); };
  }, [!!position]);
  const toggle = (key: keyof SnapSettings, label: string, disabled = false) => <label><input type="checkbox" checked={settings[key]} disabled={locked || disabled} onChange={e => tool.changeSnapping({ [key]: e.target.checked })}/><span>{label}</span></label>;
  return <div className="sb-snap-control" data-override={state.snapOverride || undefined}>
    <button className="toggle sb-snap-main" disabled={locked} aria-pressed={effective} aria-label={`Snapping ${effective ? 'on' : 'off'}`} title={`Snapping ${effective ? 'on' : 'off'}${state.snapOverride ? ' temporarily (Alt/Option held)' : ''} · N to toggle · ${overrideHint}`} onClick={tool.toggleSnapping}>
      <ToolGlyph name="Snap"/><span>Snap {effective ? 'on' : 'off'}</span><kbd>N</kbd>
    </button>
    <button ref={trigger} className="sb-snap-options" aria-label="Snap settings" aria-expanded={!!position} aria-controls={position ? id : undefined} disabled={locked} onClick={() => {
      const rect = trigger.current!.getBoundingClientRect();
      setPosition(position ? undefined : { left: rect.right + 8, top: rect.top - 120 });
    }}><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 8 4 4 4-4"/></svg></button>
    <button className="sb-snap-step-cycle" disabled={locked} aria-label={`Grid spacing ${step} m; cycle with S`} title={`${tool.freeformMode ? 'Local move step' : 'Grid spacing'}: ${step} m · S to cycle`} onClick={tool.cycleGrid}><span>{step} m</span><kbd>S</kbd></button>
    {position && createPortal(<div className="shipbuilder sb-snap-popover" id={id} ref={panel} role="group" aria-label="Snap settings" style={position}>
      <div className="sb-snap-status" role="status"><strong>Snapping {effective ? 'on' : 'off'}</strong>
        <p>{effective ? 'Pieces snap to the targets below.' : 'Free placement. Snap guides are hidden.'}{state.snapOverride && ' Release Alt / Option to restore.'}</p>
      </div>
      <strong>Snap to</strong>
      {toggle('grid', 'Grid')}
      <div className="sb-snap-step"><span>{tool.freeformMode ? 'Local move step' : 'Grid spacing'} · m</span><div role="group" aria-label="Grid spacing" className="sb-snap-steps">
        {(tool.freeformMode ? VERTEX_UNITS : SNAP_STEPS).map(value => <button key={value} aria-pressed={step === value} aria-label={`${value} m`} disabled={locked} onClick={() => tool.freeformMode ? tool.changeFreeformSettings({ unit: value }) : tool.setSnapStep(value)}>{value}</button>)}
      </div></div>
      {toggle('centerline', 'Ship centerline')}
      {toggle('geometry', 'Nearby edges, corners & centers')}
      <strong>Feedback while snapping</strong>
      {toggle('guides', 'Show snap guides')}
      {toggle('showCenterline', 'Include ship centerline', !settings.guides || !settings.centerline)}
      <p>Guides appear only when a snap is engaged. Dots mark the aligned points; a solid edge marks the target.</p>
      <div className="sb-snap-legend"><span><i/>Nearby geometry</span><span><i/>Ship centerline</span></div>
      <p><kbd>N</kbd> toggle · <kbd>S</kbd> cycle grid<br/>{overrideHint}</p>
    </div>, document.body)}
  </div>;
}
