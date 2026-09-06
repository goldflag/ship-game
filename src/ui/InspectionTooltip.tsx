import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Game } from '../game/Game';
import { INSPECTION_TOOLTIP_ID, type InspectionHoverInfo } from '../game/InspectionHover';
import { INSPECTION_KIND_LABELS, inspectionColor } from '../ships/inspection';

/** Follows the pointer over the port model: plate details in the armor view, module and compartment details in internals. */
export function InspectionTooltip({ game }: { game: Game | null }) {
  const [hover, setHover] = useState<InspectionHoverInfo | null>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setHover(null);
    return game?.subscribeInspectionHover(setHover);
  }, [game]);
  useLayoutEffect(() => {
    const element = tooltip.current;
    if (!element || !hover) return;
    const { width, height } = element.getBoundingClientRect(), margin = 12, offset = 16;
    const x = hover.x + offset + width > window.innerWidth - margin ? hover.x - width - offset : hover.x + offset;
    const y = hover.y + offset + height > window.innerHeight - margin ? hover.y - height - offset : hover.y + offset;
    element.style.left = `${Math.max(margin, Math.min(x, window.innerWidth - width - margin))}px`;
    element.style.top = `${Math.max(margin, Math.min(y, window.innerHeight - height - margin))}px`;
  }, [hover]);
  if (!hover) return null;
  const { entry } = hover, swatch = <i aria-hidden="true" style={{ background: inspectionColor(entry) }}/>;
  const dimensions = <div><dt>Dimensions</dt><dd>{entry.size.map(n => n.toFixed(1)).join(' × ')} m</dd></div>;
  return <div ref={tooltip} id={INSPECTION_TOOLTIP_ID} role="tooltip" className="port-inspection-tooltip">
    <strong>{entry.name}</strong>
    {entry.kind === 'armor' ? <dl>
      <div><dt>Thickness</dt><dd>{swatch}{entry.thicknessMm} mm</dd></div>
      {entry.plate && <div><dt>Material</dt><dd>{entry.plate.material}</dd></div>}
      {dimensions}
      {entry.provenance && <div><dt>Basis</dt><dd>{entry.provenance.basis}</dd></div>}
    </dl> : <dl>
      <div><dt>Type</dt><dd>{swatch}{INSPECTION_KIND_LABELS[entry.kind]}</dd></div>
      {entry.hp !== undefined && <div><dt>Hit points</dt><dd>{entry.hp} HP</dd></div>}
      {entry.capacityM3 !== undefined && <div><dt>Flooding capacity</dt><dd>{Math.round(entry.capacityM3).toLocaleString()} m³</dd></div>}
      {entry.pumpM3PerSecond !== undefined && <div><dt>Pumping</dt><dd>{(entry.pumpM3PerSecond * 60).toFixed(1)} m³/min</dd></div>}
      {entry.within && <div><dt>Compartment</dt><dd>{entry.within}</dd></div>}
      {dimensions}
    </dl>}
    <small>{entry.kind === 'armor' ? 'Select a row to isolate this plate.' : entry.kind === 'compartment' ? 'Floods when breached below the waterline.' : entry.kind === 'magazine' ? 'Detonates when destroyed.' : entry.kind === 'steering' ? 'Loses rudder authority when damaged.' : 'Loses propulsion power when damaged.'}</small>
  </div>;
}
