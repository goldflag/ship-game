export interface WheelItem { kind: string; label: string; sub?: string; armed?: boolean; disabled?: boolean }

const OUTER = 88, INNER = 36;
const point = (radius: number, angle: number): [number, number] => [Math.cos(angle) * radius, Math.sin(angle) * radius];

/** Orders around the selected ship: the wheel is the discoverable form of the
 * hotkeys and right-click paths listed on each sector. */
export function OrderWheel({ items, hull, hubLabel, onSelect, label }: { items: WheelItem[]; hull: number; hubLabel?: string; onSelect(kind: string, shift: boolean): void; label: string }) {
  const n = items.length, size = OUTER * 2 + 8;
  return <svg className="fleet-wheel" width={size} height={size} viewBox={`${-OUTER - 4} ${-OUTER - 4} ${size} ${size}`} role="group" aria-label={label}>
    {items.map((item, i) => {
      const a0 = -Math.PI / 2 - Math.PI / n + i * 2 * Math.PI / n + .03, a1 = a0 + 2 * Math.PI / n - .06, mid = (a0 + a1) / 2;
      const [x0, y0] = point(OUTER, a0), [x1, y1] = point(OUTER, a1), [x2, y2] = point(INNER, a1), [x3, y3] = point(INNER, a0), [tx, ty] = point((OUTER + INNER) / 2 + 2, mid);
      return <g key={item.kind} className={`fleet-wheel-item ${item.armed ? 'armed' : ''} ${item.disabled ? 'disabled' : ''}`} role="button" tabIndex={item.disabled ? -1 : 0} aria-pressed={item.armed} aria-disabled={item.disabled} aria-label={`${item.label}${item.sub ? ` · ${item.sub}` : ''}`}
        onClick={e => { e.stopPropagation(); if (!item.disabled) onSelect(item.kind, e.shiftKey); }} onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && !item.disabled) { e.preventDefault(); e.stopPropagation(); onSelect(item.kind, e.shiftKey); } }}>
        <path d={`M${x0} ${y0}A${OUTER} ${OUTER} 0 0 1 ${x1} ${y1}L${x2} ${y2}A${INNER} ${INNER} 0 0 0 ${x3} ${y3}Z`}/>
        <text x={tx} y={ty + (item.sub ? 0 : 4)}>{item.label}</text>
        {item.sub && <text className="fleet-wheel-sub" x={tx} y={ty + 13}>{item.sub}</text>}
      </g>;
    })}
    <circle className="fleet-wheel-hub" r={INNER - 8}/>
    <circle className="fleet-wheel-hull" r={INNER - 8} strokeDasharray={`${2 * Math.PI * (INNER - 8) * Math.max(0, Math.min(1, hull))} ${2 * Math.PI * (INNER - 8)}`} transform="rotate(-90)"/>
    <text className="fleet-wheel-hp" y="5">{hubLabel ?? `${Math.round(hull * 100)}%`}</text>
  </svg>;
}
