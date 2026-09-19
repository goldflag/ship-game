import { Select, SelectOption } from '../components';
import { CONSTRUCTION_PAINTS, constructionPaintColor } from '../../ships/constructionPaints';
import { editHullPaintBands, hullPaintBands, hullPaintHeightRange, MAX_HULL_PAINT_BANDS } from '../../ships/hullPaintBands';
import { hullExtent, uid, type Hull } from '../../ships/customHullModel';
import { NumberField } from './NumberField';

export function HullPaintControls({ hull, waterline, measurable, edit }: {
  hull: Hull; waterline?: number; measurable: boolean; edit(change: (draft: Hull) => void): void;
}) {
  const bands = hullPaintBands(hull), { base, deck } = hullExtent(hull);
  // Prefer adding above the last band. If it reaches the deck, split an existing interval.
  const gap = Array.from({ length: bands.length + 1 }, (_, i) => ({ index: i,
    low: Math.max(base, i ? bands[i - 1].upperY : base), high: Math.min(deck, i < bands.length ? bands[i].upperY : deck),
  })).reverse().find(g => g.high - g.low >= .02);
  const add = () => {
    if (!gap || bands.length >= MAX_HULL_PAINT_BANDS) return;
    edit(draft => {
      const next = editHullPaintBands(draft);
      const upperY = !next.length ? Math.max(gap.low + .01, Math.min(gap.high, -.02 * draft.depth))
        : gap.low + Math.min((gap.high - gap.low) / 2, Math.max(.1, draft.depth * .04));
      next.splice(gap.index, 0, { id: `paint-${uid()}`, upperY, paint: !next.length ? 'red-oxide' : next.length === 1 ? 'boot-top-black' : 'naval-gray' });
    });
  };
  return <section className="hs-paint-controls" aria-label="Hull paint bands">
    <h4>Paint bands</h4>
    <p className="hs-paint-help">Heights above the hull base. Existing paint stays above the last band.</p>
    {bands.length === 0 && <p className="hs-paint-empty">No height bands. The hull uses its face paint.</p>}
    <ol className="hs-paint-bands">
      {bands.map((band, index) => {
        const [min, max] = hullPaintHeightRange(bands, index, base, deck);
        const setHeight = (y: number) => edit(draft => { editHullPaintBands(draft)[index].upperY = y; });
        return <li key={band.id}>
          <div className="hs-paint-choice">
            <span className="hs-paint-number" title={`Band ${index + 1}, from the bottom`}>{index + 1}</span>
            <Select aria-label={`Band ${index + 1} color`} value={band.paint} onValueChange={paint => edit(draft => { editHullPaintBands(draft)[index].paint = paint; })}>
              {CONSTRUCTION_PAINTS.map(paint => <SelectOption key={paint.id} value={paint.id}><span className="hs-paint-swatch" style={{ background: constructionPaintColor(paint.id) }} />{paint.name}</SelectOption>)}
            </Select>
            <button className="hs-paint-remove" aria-label={`Remove band ${index + 1}`} title={`Remove band ${index + 1}`} onClick={() => edit(draft => { editHullPaintBands(draft).splice(index, 1); })}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" /></svg>
            </button>
          </div>
          <div className="hs-paint-height"><span>Up to</span><NumberField label={`Band ${index + 1} height above the base`} value={band.upperY - base} min={min - base} max={max - base} step={.1} unit="m" onChange={v => setHeight(base + v)} /></div>
          {measurable && <button className="hs-link" aria-label={`Set band ${index + 1} to the waterline`} disabled={waterline === undefined || waterline < min || waterline > max} onClick={() => waterline !== undefined && setHeight(waterline)}>Use waterline</button>}
        </li>;
      })}
    </ol>
    <button className="hs-button hs-add-paint" onClick={add} disabled={!gap || bands.length >= MAX_HULL_PAINT_BANDS}>
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 3v10M3 8h10" /></svg>Add band
    </button>
    {bands.length === MAX_HULL_PAINT_BANDS && <p className="hs-paint-help">Maximum of 8 bands.</p>}
  </section>;
}
