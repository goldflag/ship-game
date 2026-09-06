import { useState } from 'react';
import type { ShipDefinition } from '../ships/blueprint';
import { shipScores, shipStatistics, type StatSection } from '../ships/statistics';
import { Icon } from './Icons';

/** Illustrative refit bonus applied by the Equipment tab's hull upgrade. */
export const HULL_REFIT_SURVIVABILITY_BONUS = 8;

export function ShipScores({ definition, hullRefit = false }: { definition: ShipDefinition; hullRefit?: boolean }) {
  return <div className="garage-ship-stats" aria-label="Category scores">
    {shipScores(definition).map(score => {
      const value = score.id === 'survivability' && hullRefit ? Math.min(100, score.score + HULL_REFIT_SURVIVABILITY_BONUS) : score.score;
      return <div key={score.id} title={score.help}>
        <span>{score.label}</span>
        <strong>{value}</strong>
        <i><b style={{ width: `${value}%` }} /></i>
      </div>;
    })}
  </div>;
}

function Section({ section, open, onToggle }: { section: StatSection; open: boolean; onToggle(): void }) {
  const id = `port-stat-${section.id}`;
  return <section className="port-stat-section">
    <button aria-expanded={open} aria-controls={id} title={section.headlineHelp} onClick={onToggle}>
      <Icon name="chevron" size={14} />
      <span>{section.title}</span>
      <strong>{section.headline}{section.headlineUnit && <small>{section.headlineUnit}</small>}</strong>
    </button>
    {open && <div id={id} className="port-stat-rows">
      {section.rows.map(row => <div key={row.label} className={`port-stat-row ${row.text ? 'port-stat-row-text' : ''}`} title={row.help}>
        <span>{row.label}</span>
        <strong>{row.value}{row.unit && <small>{row.unit}</small>}</strong>
      </div>)}
      {section.notes?.map(note => <p key={note.label} className="port-stat-note"><b>{note.label}.</b> {note.text}</p>)}
    </div>}
  </section>;
}

/** Detailed sheet read from the compiled definition combat uses. Hover a row for what the figure means. */
export function ShipStatistics({ definition, hullRefit = false }: { definition: ShipDefinition; hullRefit?: boolean }) {
  const sections = shipStatistics(definition);
  const [open, setOpen] = useState<Record<string, boolean>>(() => Object.fromEntries(sections.map(s => [s.id, !s.collapsed])));
  return <div className="port-statistics">
    <ShipScores definition={definition} hullRefit={hullRefit} />
    <p className="port-inspector-intro">Figures come from the combat definition of this ship. Hover a row for its meaning.</p>
    {sections.map(section => <Section key={section.id} section={section} open={open[section.id] ?? true} onToggle={() => setOpen(value => ({ ...value, [section.id]: !(value[section.id] ?? true) }))} />)}
  </div>;
}
