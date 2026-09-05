import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Game } from '../game/Game';
import { ARMOR_TOOLTIP_ID, type ArmorHoverInfo } from '../game/ArmorHover';
import { inspectionColor } from '../ships/inspection';

export function ArmorTooltip({ game }: { game: Game | null }) {
  const [hover, setHover] = useState<ArmorHoverInfo | null>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setHover(null);
    return game?.subscribeArmorHover(setHover);
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
  const { entry } = hover;
  return <div ref={tooltip} id={ARMOR_TOOLTIP_ID} role="tooltip" className="port-armor-tooltip">
    <strong>{entry.name}</strong>
    <dl>
      <div><dt>Thickness</dt><dd><i aria-hidden="true" style={{ background: inspectionColor(entry) }}/>{entry.thicknessMm} mm</dd></div>
      {entry.plate && <div><dt>Material</dt><dd>{entry.plate.material}</dd></div>}
      <div><dt>Dimensions</dt><dd>{entry.size.map(n => n.toFixed(1)).join(' × ')} m</dd></div>
      {entry.provenance && <div><dt>Basis</dt><dd>{entry.provenance.basis}</dd></div>}
    </dl>
  </div>;
}
