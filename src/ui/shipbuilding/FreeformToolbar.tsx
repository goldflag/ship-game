import { useEffect, useRef, useState } from 'react';
import type { ConstructionPrimitive } from '../../ships/blueprint';
import { selectionCenter, selectionLabel, selectionLocks, type HullSelection, type HullSelectionMode, type MirrorAxes } from '../../ships/constructionVertex';
import { NumberField } from './NumberField';
import type { BuilderView } from './builderScene';

export type { FreeformSettings } from './builderTool';
import type { FreeformSettings } from './builderTool';
export function FreeformToolbar({ primitive, settings: s, onChange, cycleUnit, onCoordinate, onView, perspective, onProjection, onReset, onSplit, onExit }: {
  primitive: ConstructionPrimitive; settings: FreeformSettings; onChange(patch: Partial<FreeformSettings>): void; cycleUnit(): void;
  onCoordinate(axis: number, value: number): void; onView(view: BuilderView): void; perspective: boolean;
  onProjection(): void; onReset(): void; onSplit(): void; onExit(): void;
}) {
  const [splitOpen, setSplitOpen] = useState(false);
  const split = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!splitOpen) return;
    const outside = (e: PointerEvent) => { if (!split.current?.contains(e.target as Node)) setSplitOpen(false); };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); setSplitOpen(false); split.current?.querySelector('button')?.focus(); }
    };
    window.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', escape, true);
    return () => { window.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', escape, true); };
  }, [splitOpen]);
  const position = selectionCenter(primitive, s.selection), locks = selectionLocks(s.selection, s.axes);
  const count = s.selection.mode === 'vertex' ? 8 : s.selection.mode === 'edge' ? 12 : 6;
  const locked = ['X','Y','Z'].filter((_,k) => locks[k]);
  const mode = (mode: HullSelectionMode) => onChange({ selection: { mode, index: mode === 'face' ? 5 : 0 } });
  return <section className="sb-freeform-tools" aria-label="Freeform hull editor">
    <div className="sb-freeform-title">
      <strong>Freeform hull</strong><span>Local block axes</span><button onClick={onExit}>Done <kbd>Esc</kbd></button>
    </div>
    <div className="sb-freeform-controls">
      <div className="sb-freeform-group">
        <span>Select</span><div className="sb-freeform-row" role="group" aria-label="Selection mode">
          {(['vertex','edge','face'] as const).map(m => <button key={m} aria-pressed={s.selection.mode === m} onClick={() => mode(m)}>{m[0].toUpperCase() + m.slice(1)}</button>)}
        </div>
      </div>
      <div className="sb-freeform-group">
        <span>Mirror {s.axes.some(Boolean) ? '' : 'off'}</span><div className="sb-freeform-row" role="group" aria-label="Local mirror axes">
          {['X','Y','Z'].map((a,k) => <button key={a} aria-label={`Mirror ${a}`} aria-pressed={s.axes[k]} title={`Reflect movement across the block's local ${a} plane`} onClick={() => { const axes: MirrorAxes = [...s.axes]; axes[k] = !axes[k]; onChange({ axes }); }}>{a}</button>)}
        </div>
      </div>
      <div className="sb-freeform-group">
        <span>Move step</span><button className="sb-unit" aria-label="Cycle move step" onClick={cycleUnit} title="Cycle move increments: 0.05, 0.1, 0.2, 0.5, 1, 2 m (G)"><b>{s.unit} m</b><kbd>G</kbd></button>
      </div>
      <div className="sb-freeform-group">
        <span>Neighbors</span><button aria-label="Move nearby corners" aria-pressed={s.snap} onClick={() => onChange({ snap: !s.snap })} title="Also move corners of neighboring blocks within 0.025 m; no permanent link is created">Move nearby corners <b>{s.snap ? 'On' : 'Off'}</b></button>
      </div>
      <div className="sb-freeform-group sb-freeform-split-menu" ref={split}>
        <span>Shape</span><button aria-expanded={splitOpen} onClick={() => setSplitOpen(open => !open)}>Split…</button>
        {splitOpen && <div className="sb-freeform-popover" role="group" aria-label="Split block">
          <span>Split along local axis</span><div className="sb-freeform-row">{['X','Y','Z'].map((a,k) => <button key={a} aria-label={`Split ${a}`} aria-pressed={s.splitAxis === k} onClick={() => onChange({ splitAxis: k })}>{a}</button>)}</div>
          <NumberField label="Count" value={s.count} min={2} max={16} onChange={count => onChange({ count: Math.round(count) })}/>
          <span>Creates independent blocks.</span><button onClick={onSplit}>Split block</button>
        </div>}
      </div>
    </div>
    <div className="sb-freeform-coordinates">
      <select aria-label="Hull selection" value={s.selection.index} onChange={e => onChange({ selection: { ...s.selection, index: Number(e.target.value) } })}>
        {Array.from({ length: count }, (_,index) => <option key={index} value={index}>{selectionLabel({ mode: s.selection.mode, index })}</option>)}
      </select>
      <span>{s.selection.mode === 'vertex' ? 'Position' : 'Center'}</span>
      {['X','Y','Z'].map((a,k) => <NumberField key={`${primitive.id}-${s.selection.mode}-${s.selection.index}-${a}`} label={a} description={locks[k] ? `Locked by ${a} symmetry. Turn off Mirror ${a} to move across this plane.` : `Local ${a} ${s.selection.mode === 'vertex' ? 'position' : 'center'}`} disabled={locks[k]} value={position[k]} min={-1000} max={1000} step={s.unit} unit="m" onChange={value => onCoordinate(k,value)}/>)}
      <button onClick={onReset} title="Restore this block to the shape it had when this edit session began">Reset edit</button>
    </div>
    <div className="sb-freeform-footer">
      <div className="sb-freeform-row" role="group" aria-label="Hull views">
        {(['side','top','bow'] as const).map(v => <button key={v} onClick={() => onView(v)}>{v === 'side' ? 'Side' : v === 'top' ? 'Top' : 'Bow'}</button>)}
        <button onClick={onProjection} title="Toggle orthographic and perspective cameras (P)">{perspective ? 'Perspective' : 'Orthographic'} <kbd>P</kbd></button>
      </div>
      <p>{locked.length ? `${locked.join('/')} movement locked by symmetry. ` : ''}Drag handles to move; X/Y/Z handles lock direction. Esc cancels a drag.</p>
    </div>
  </section>;
}
