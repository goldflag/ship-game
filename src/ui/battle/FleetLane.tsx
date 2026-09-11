import { useState, type DragEvent, type ReactNode } from 'react';

interface LaneProps {
  label: string; title: ReactNode; tone?: 'friendly' | 'enemy' | 'neutral' | 'ghost'; count?: ReactNode; extra?: ReactNode;
  /** A ship is picked or dragged; the lane accepts a drop, click or Enter. */
  active: boolean; disabled?: boolean; onPlace(): void; hint: ReactNode; children?: ReactNode; className?: string;
}
/** Drop target for ships. Dragging, or choosing a ship and then the lane, place it here. */
export function FleetLane({ label, title, tone = 'neutral', count, extra, active, disabled, onPlace, hint, children, className = '' }: LaneProps) {
  const [over, setOver] = useState(false);
  const accepts = active && !disabled;
  const dragOver = (event: DragEvent<HTMLElement>) => { if (!accepts) return; event.preventDefault(); event.stopPropagation(); setOver(true); };
  return <section className={`fleet-lane ${tone} ${over ? 'is-drop-target' : ''} ${accepts ? 'is-accepting' : ''} ${className}`} aria-label={label} tabIndex={accepts ? 0 : -1}
    onDragOver={dragOver} onDragEnter={dragOver}
    onDragLeave={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setOver(false); }}
    onDrop={event => { event.preventDefault(); event.stopPropagation(); setOver(false); if (accepts) onPlace(); }}
    onClick={event => { if (accepts && !(event.target as HTMLElement).closest('button,input,[role=combobox],a')) onPlace(); }}
    onKeyDown={event => { if (event.target === event.currentTarget && accepts && ['Enter', ' '].includes(event.key)) { event.preventDefault(); onPlace(); } }}>
    <header className="fleet-lane-head"><h3>{title}</h3>{count !== undefined && <span className="fleet-lane-count">{count}</span>}{extra && <div className="fleet-lane-extra">{extra}</div>}</header>
    {children}
    <p className="fleet-lane-drop">{hint}</p>
  </section>;
}
export interface MeterItem { label: string; reading: string; used: number; max: number; }
/** Allowance meters for modes with a budget. */
export function BudgetStrip({ items, label }: { items: MeterItem[]; label: string }) {
  return <div className="fleet-budget" role="group" aria-label={label}>{items.map(item => <div key={item.label} className={`fleet-meter ${item.used > item.max ? 'is-over' : ''}`}>
    <div><span>{item.label}</span><strong>{item.reading}</strong></div>
    <meter min={0} max={Math.max(1, item.max)} value={Math.min(item.used, item.max)} aria-label={item.label}/>
  </div>)}</div>;
}
