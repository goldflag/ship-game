import { FreeformMeshTools } from './FreeformMeshTools';
import { FreeformShapeTools } from './FreeformShapeTools';
import type { ConstructionPrimitive } from '../../ships/blueprint';
import { useEffect, useRef, useState } from 'react';
import type { HullSelectionMode, MirrorAxes } from '../../ships/constructionVertex';
import { NumberField } from './NumberField';
import { blockDimensions, dimensionText } from './blockDimensions';

export type { FreeformSettings } from './builderTool';
import type { FreeformSettings } from './builderTool';
export function FreeformToolbar({ primitive, preview, onCommit, settings: s, onChange, cycleUnit, onReset, onSplit, onExit }: {
  primitive: ConstructionPrimitive; onCommit(replacements: ConstructionPrimitive[]): unknown;
  preview?: ConstructionPrimitive;
  settings: FreeformSettings; onChange(patch: Partial<FreeformSettings>): void; cycleUnit(): void; onReset(): void; onSplit(): void; onExit(): void;
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
  const mode = (mode: HullSelectionMode) => onChange({ selection: { mode, index: mode === 'face' && !primitive.mesh ? 5 : 0 } });
  return <section className="sb-freeform-tools" aria-label="Freeform hull editor">
    <div className="sb-freeform-title">
      <strong>Freeform {primitive.mesh?.label.toLowerCase() ?? 'block'}</strong>
      <button className="sb-freeform-reset" onClick={onReset} title="Restore this block to the shape it had when this edit session began">Reset edit</button><button onClick={onExit}>Done <kbd>D / Esc</kbd></button>
    </div>
    <div className="sb-freeform-dimensions"><span>Width × height × length</span><output aria-label="Current block dimensions">{dimensionText(blockDimensions(preview?.id === primitive.id ? preview : primitive))}</output><span>Local block axes</span></div>
    <div className="sb-freeform-controls">
      <div className="sb-freeform-group">
        <span>Select</span><div className="sb-freeform-row" role="group" aria-label="Selection mode">
          {([...(['vertex','edge','face'] as const),...(primitive.mesh?.rings.length?['ring' as const]:[])]).map(m => <button key={m} aria-pressed={s.selection.mode === m} onClick={() => mode(m)}>{m[0].toUpperCase() + m.slice(1)}</button>)}
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
      {!primitive.mesh && <div className="sb-freeform-group sb-freeform-split-menu" ref={split}>
        <span>Shape</span><button aria-expanded={splitOpen} onClick={() => setSplitOpen(open => !open)}>Split…</button>
        {splitOpen && <div className="sb-freeform-popover" role="group" aria-label="Split block">
          <span>Split along local axis</span><div className="sb-freeform-row">{['X','Y','Z'].map((a,k) => <button key={a} aria-label={`Split ${a}`} aria-pressed={s.splitAxis === k} onClick={() => onChange({ splitAxis: k })}>{a}</button>)}</div>
          <NumberField label="Count" value={s.count} min={2} max={16} onChange={count => onChange({ count: Math.round(count) })}/>
          <span>Creates independent blocks.</span><button disabled={!!primitive.shaping} title={primitive.shaping ? "Remove edge treatment before splitting" : undefined} onClick={onSplit}>Split block</button>
        </div>}
      </div>}
    </div>
    {primitive.mesh ? <FreeformMeshTools primitive={primitive} selection={s.selection} onCommit={onCommit} onSelect={selection=>onChange({selection})}/> : <FreeformShapeTools primitive={primitive} selection={s.selection} axes={s.axes} onCommit={onCommit} onSelect={selection=>onChange({selection})}/>}
  </section>;
}
