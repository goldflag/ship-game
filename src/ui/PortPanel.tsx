// The port's right-hand column: one fixed place for the ship's ratings, particulars, full sheet and
// the armor, equipment and flooding views. Lists are grouped the way the ship is built; selecting a
// zone, group or space isolates the same volumes in the 3D view.
import { useEffect, useMemo, useRef, useState, type FocusEvent, type PointerEvent, type ReactNode } from 'react';
import type { ShipDefinition } from '../ships/blueprint';
import { ARMOR_COLOR_STOPS, INSPECTION_COLORS, armorThicknessColor, type InspectionMode } from '../ships/inspection';
import {
  armorZones,
  equipmentGroups,
  floodingSpaces,
  modeEntries,
  profilePoint,
  sideProfile,
  type ArmorZone,
  type EquipmentGroup,
  type FloodingSpace,
  type ShipProfile,
} from '../ships/particulars';
import { shipParticulars, shipScores, shipStatistics, type StatSection } from '../ships/statistics';
import { shipPreset, shipPresets } from '../ships/presets';
import { shipIdentity } from '../game/shipModel';
import { Input } from './components';
import { Icon } from './Icons';
import './PortPanel.css';

/** What the 3D view isolates: one plate or module, or a whole zone, group or space. */
export interface PortSelection {
  key: string;
  ids: readonly string[];
  label: string;
}

const format = (n: number, digits = 0) => n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const plural = (n: number, one: string, many = `${one}s`) => `${format(n)} ${n === 1 ? one : many}`;
const IDLE_HELP = 'Hover a figure to see what it means.';
const TABS: { mode: InspectionMode; label: string }[] = [
  { mode: 'exterior', label: 'Overview' },
  { mode: 'armor', label: 'Armor' },
  { mode: 'internals', label: 'Equipment' },
  { mode: 'compartments', label: 'Flooding' },
];
const MODE_HELP: Record<InspectionMode, string> = {
  exterior: IDLE_HELP,
  armor: 'Select a zone to isolate its plates. The profile marks where it sits.',
  internals: 'Select a group to isolate it; dots on the profile show where each module sits.',
  compartments: 'Select a space to isolate its flooding volume. Deeper blue holds more water.',
};

/** Historical battleships, cruisers, destroyers and escorts: the yardstick ticked on every rating. */
let referenceFleet: { id: string; name: string; scores: number[] }[] | undefined;
export function historicalFleet() {
  referenceFleet ??= Object.keys(shipPresets)
    .filter((id) => {
      const identity = shipIdentity(id);
      return !!identity.nation && /battleship|cruiser|destroyer|corvette/i.test(identity.type);
    })
    .map((id) => {
      const def = shipPreset(id);
      return { id, name: def.name, scores: shipScores(def).map((score) => score.score) };
    });
  return referenceFleet;
}
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;

export function PortPanel({
  definition,
  mode,
  onMode,
  ready,
  selection,
  onSelect,
}: {
  definition: ShipDefinition;
  mode: InspectionMode;
  onMode(mode: InspectionMode): void;
  ready: boolean;
  selection?: PortSelection;
  onSelect(selection?: PortSelection): void;
}) {
  const [help, setHelp] = useState<{ title?: string; text: string }>();
  const counts = useMemo(
    () => ({ armor: modeEntries(definition, 'armor').length, internals: modeEntries(definition, 'internals').length, compartments: modeEntries(definition, 'compartments').length }),
    [definition],
  );
  const explain = (event: PointerEvent | FocusEvent) => {
    const target = (event.target as Element).closest<HTMLElement>('[data-help]');
    setHelp(target ? { title: target.dataset.helpTitle, text: target.dataset.help! } : undefined);
  };
  useEffect(() => setHelp(undefined), [mode, definition]);
  return (
    <aside className="port-panel" aria-label="Ship particulars" onPointerOver={explain} onFocus={explain} onPointerLeave={() => setHelp(undefined)}>
      <div className="port-panel-tabs" role="group" aria-label="Ship model view">
        {TABS.map((tab) => (
          <button key={tab.mode} disabled={!ready} aria-pressed={mode === tab.mode} onClick={() => onMode(tab.mode)}>
            {tab.label}
            {tab.mode !== 'exterior' && <small>{format(counts[tab.mode])}</small>}
          </button>
        ))}
      </div>
      {mode === 'exterior' ? (
        <Overview key={definition.id} definition={definition} />
      ) : (
        <div className="port-panel-scroll" key={`${definition.id}:${mode}`}>
          {mode === 'armor' ? (
            <ArmorTab definition={definition} selection={selection} onSelect={onSelect} />
          ) : mode === 'internals' ? (
            <EquipmentTab definition={definition} selection={selection} onSelect={onSelect} />
          ) : (
            <FloodingTab definition={definition} selection={selection} onSelect={onSelect} />
          )}
        </div>
      )}
      {selection && (
        <div className="port-panel-isolated" role="status">
          <span>
            Showing only <b>{selection.label}</b>
          </span>
          <button onClick={() => onSelect(undefined)}>Show all</button>
        </div>
      )}
      <p className="port-panel-help" aria-live="polite">
        {help ? (
          <>
            {help.title && <b>{help.title}. </b>}
            {help.text}
          </>
        ) : (
          MODE_HELP[mode]
        )}
      </p>
    </aside>
  );
}

/* ---------- Overview: ratings, particulars and the full sheet ---------- */

function Overview({ definition }: { definition: ShipDefinition }) {
  const scores = useMemo(() => shipScores(definition), [definition]);
  const fleet = useMemo(() => historicalFleet().filter((ship) => ship.id !== definition.id), [definition.id]);
  const figures = useMemo(() => shipParticulars(definition), [definition]);
  const sections = useMemo(() => shipStatistics(definition), [definition]);
  const [open, setOpen] = useState<string>();
  return (
    <div className="port-panel-scroll">
      <h3 className="port-eyebrow">
        Ratings <span>ticks mark {fleet.length} historical warships</span>
      </h3>
      <div className="port-ratings">
        {scores.map((score, i) => {
          const all = [...fleet.map((ship) => ship.scores[i]), score.score].sort((a, b) => b - a);
          const rank = all.indexOf(score.score) + 1,
            capped = score.score >= 100;
          return (
            <div key={score.id} className="port-rating" data-help-title={score.label} data-help={`${score.help} Ticks mark the historical warships.`}>
              <div className="port-rating-head">
                <span>{score.label}</span>
                <em data-capped={capped}>
                  {capped ? 'capped · ' : ''}
                  {ordinal(rank)} of {all.length}
                </em>
                <strong>{score.score}</strong>
              </div>
              <div className="port-rating-track">
                <i style={{ width: `${score.score}%` }} />
                {fleet.map((ship) => (
                  <s key={ship.id} style={{ left: `${ship.scores[i]}%` }} data-help-title={ship.name} data-help={`${score.label} ${ship.scores[i]}.`} />
                ))}
                <u style={{ left: `${score.score}%` }} />
              </div>
            </div>
          );
        })}
      </div>
      <h3 className="port-eyebrow">Particulars</h3>
      <dl className="port-particulars">
        {figures.map((figure) => (
          <div key={figure.label} data-help-title={figure.label} data-help={figure.help}>
            <dt>{figure.label}</dt>
            <dd>
              {figure.value}
              {figure.unit && <small>{figure.unit}</small>}
            </dd>
          </div>
        ))}
      </dl>
      <h3 className="port-eyebrow">Full sheet</h3>
      <div className="port-sheet">
        {sections.map((section) => (
          <SheetSection key={section.id} section={section} open={open === section.id} onToggle={() => setOpen(open === section.id ? undefined : section.id)} />
        ))}
      </div>
    </div>
  );
}

function SheetSection({ section, open, onToggle }: { section: StatSection; open: boolean; onToggle(): void }) {
  const id = `port-sheet-${section.id}`;
  return (
    <section className="port-sheet-section">
      <button aria-expanded={open} aria-controls={id} onClick={onToggle} data-help-title={section.title} data-help={section.headlineHelp}>
        <Icon name="chevron" size={14} />
        <span>
          {section.title}
          {section.subtitle && <small>{section.subtitle}</small>}
        </span>
        <strong>
          {section.headline}
          {section.headlineUnit && <small>{section.headlineUnit}</small>}
        </strong>
      </button>
      {open && (
        <div id={id} className="port-sheet-rows">
          {section.rows.map((row, i) => (
            <div key={`${row.label}:${i}`} className={row.text ? 'port-sheet-text' : undefined} data-help-title={row.label} data-help={row.help}>
              <span>{row.label}</span>
              <strong>
                {row.value}
                {row.unit && <small>{row.unit}</small>}
              </strong>
            </div>
          ))}
          {section.notes?.map((note) => (
            <p key={note.label} className="port-sheet-note">
              <b>{note.label}.</b> {note.text}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

/* ---------- Side profile ---------- */

interface ProfileMark {
  y: number;
  z: number;
  color: string;
  on: boolean;
}
interface ProfileBox {
  z0: number;
  z1: number;
  y0: number;
  y1: number;
  fill: number;
  on: boolean;
}
const CANVAS_WIDTH = 760;
const baseLayers = new WeakMap<ShipDefinition, Map<string, HTMLCanvasElement>>();
function profileFrame(profile: ShipProfile) {
  const height = Math.round(Math.min(200, Math.max(56, (CANVAS_WIDTH * (profile.y1 - profile.y0)) / (profile.z1 - profile.z0))));
  const scale = Math.min(CANVAS_WIDTH / (profile.z1 - profile.z0), height / (profile.y1 - profile.y0));
  const left = (CANVAS_WIDTH - (profile.z1 - profile.z0) * scale) / 2;
  return { height, x: (z: number) => left + (z - profile.z0) * scale, y: (y: number) => height - (y - profile.y0) * scale - (height - (profile.y1 - profile.y0) * scale) / 2 };
}
function drawShapes(context: CanvasRenderingContext2D, profile: ShipProfile, frame: ReturnType<typeof profileFrame>, armor: boolean, only?: ReadonlySet<string>) {
  context.lineWidth = 2;
  context.lineJoin = 'round';
  for (const shape of profile.shapes) {
    if (only && !only.has(shape.id)) continue;
    context.fillStyle = context.strokeStyle = armor ? armorThicknessColor(shape.mm) : '#3c5a66';
    context.beginPath();
    for (let i = 0; i < shape.points.length; i += 2) context.lineTo(frame.x(shape.points[i]), frame.y(shape.points[i + 1]));
    context.closePath();
    context.fill();
    // Decks and roofs are edge-on from the side; a stroke keeps an isolated deck visible.
    if (only) context.stroke();
  }
}
/** Every plate projected onto the centreline, coloured by thickness or as a plain silhouette. */
function ProfileView({
  definition,
  armor,
  highlight,
  marks = [],
  boxes = [],
  span,
}: {
  definition: ShipDefinition;
  armor: boolean;
  highlight?: readonly string[];
  marks?: ProfileMark[];
  boxes?: ProfileBox[];
  span?: { from: number; to: number; label: string };
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const profile = useMemo(() => sideProfile(definition), [definition]);
  const frame = useMemo(() => profileFrame(profile), [profile]);
  useEffect(() => {
    const element = canvas.current,
      context = element?.getContext('2d');
    if (!element || !context) return;
    const layers = baseLayers.get(definition) ?? new Map<string, HTMLCanvasElement>();
    baseLayers.set(definition, layers);
    let base = layers.get(String(armor));
    if (!base) {
      base = document.createElement('canvas');
      base.width = CANVAS_WIDTH;
      base.height = frame.height;
      drawShapes(base.getContext('2d')!, profile, frame, armor);
      layers.set(String(armor), base);
    }
    context.clearRect(0, 0, element.width, element.height);
    const only = highlight?.length && armor ? new Set(highlight) : undefined;
    context.globalAlpha = only || marks.some((m) => m.on) || boxes.some((b) => b.on) ? 0.3 : armor ? 0.9 : 0.8;
    context.drawImage(base, 0, 0);
    context.globalAlpha = 1;
    if (only) drawShapes(context, profile, frame, true, only);
    context.setLineDash([5, 5]);
    context.strokeStyle = 'rgba(158, 202, 209, .75)';
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(0, frame.y(0));
    context.lineTo(CANVAS_WIDTH, frame.y(0));
    context.stroke();
    context.setLineDash([]);
    for (const box of boxes) {
      const x = frame.x(box.z0),
        y = frame.y(box.y1),
        w = frame.x(box.z1) - x,
        h = frame.y(box.y0) - y;
      context.fillStyle = `rgba(95, 159, 196, ${(box.on ? 0.25 + 0.5 * box.fill : 0.06 + 0.3 * box.fill).toFixed(2)})`;
      context.fillRect(x, y, w, h);
      context.strokeStyle = box.on ? '#e5bf80' : 'rgba(158, 202, 209, .45)';
      context.lineWidth = box.on ? 2 : 1;
      context.strokeRect(x, y, w, h);
    }
    for (const mark of [...marks].sort((a, b) => Number(a.on) - Number(b.on))) {
      context.globalAlpha = mark.on || !marks.some((m) => m.on) ? 1 : 0.35;
      context.fillStyle = mark.color;
      context.strokeStyle = '#0b1b24';
      context.lineWidth = 1.5;
      context.beginPath();
      context.arc(frame.x(mark.z), frame.y(mark.y), mark.on ? 5 : 3.6, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    }
    context.globalAlpha = 1;
  }, [definition, profile, frame, armor, highlight, marks, boxes]);
  const at = (metresFromBow: number) => ((frame.x(metresFromBow - definition.hull.length / 2) / CANVAS_WIDTH) * 100).toFixed(2);
  return (
    <div className="port-profile" data-help-title="Profile" data-help="The ship from starboard, bow at left. The dashed line is the waterline.">
      <canvas ref={canvas} width={CANVAS_WIDTH} height={frame.height} aria-hidden="true" />
      {span && (
        <div className="port-profile-span">
          <i style={{ left: `${at(span.from)}%`, width: `${Math.max(0.5, +at(span.to) - +at(span.from))}%` }} />
          {span.label}
        </div>
      )}
    </div>
  );
}

/* ---------- Armor ---------- */

const zoneColor = (zone: ArmorZone) => (zone.reduction !== undefined ? '#79aacf' : armorThicknessColor(zone.maxMm));
const zoneReading = (zone: ArmorZone) =>
  zone.reduction !== undefined ? (
    <>
      {Math.round(zone.reduction * 100)}
      <small>% cut</small>
    </>
  ) : (
    <>
      {zone.minMm === zone.maxMm ? format(zone.maxMm, zone.maxMm % 1 ? 1 : 0) : `${format(zone.minMm, zone.minMm % 1 ? 1 : 0)}–${format(zone.maxMm, zone.maxMm % 1 ? 1 : 0)}`}
      <small>mm</small>
    </>
  );
const spanText = ([from, to]: [number, number]) => `${format(from)}–${format(to)} m`;
const scaleMax = ARMOR_COLOR_STOPS[ARMOR_COLOR_STOPS.length - 1].thicknessMm;
const armorRamp = `linear-gradient(to right, ${ARMOR_COLOR_STOPS.map((stop) => `${stop.color} ${(stop.thicknessMm / scaleMax) * 100}%`).join(', ')})`;

type TabProps = { definition: ShipDefinition; selection?: PortSelection; onSelect(selection?: PortSelection): void };
const toggle = (props: TabProps, next: PortSelection) => props.onSelect(props.selection?.key === next.key ? undefined : next);

function ArmorTab(props: TabProps) {
  const { definition, selection } = props;
  const zones = useMemo(() => armorZones(definition), [definition]);
  const entries = useMemo(() => modeEntries(definition, 'armor'), [definition]);
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const matches = useMemo(() => (needle ? entries.filter((entry) => entry.name.toLowerCase().includes(needle)) : []), [entries, needle]);
  const zoneId = selection?.key.startsWith('zone:') ? selection.key.split(':')[1] : undefined;
  const zone = zones.find((z) => z.id === zoneId);
  const plates = entries.length;
  return (
    <>
      <ProfileView
        definition={definition}
        armor
        highlight={selection?.ids}
        span={zone && { from: zone.span[0], to: zone.span[1], label: `${zone.label} · ${spanText(zone.span)} from the bow` }}
      />
      <div className="port-armor-scale" data-help-title="Thickness" data-help="The port's fixed scale: equal thicknesses share a colour on every ship.">
        <i style={{ background: armorRamp }} />
        <span>0 mm</span>
        <span>{scaleMax / 2}</span>
        <span>{scaleMax}+ mm</span>
      </div>
      <label className="port-panel-search">
        <span>Find a plate</span>
        <Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Belt, barbette, turret…" />
      </label>
      {needle ? (
        <div className="port-groups">
          <h3 className="port-eyebrow">
            Matching plates <span>{plural(matches.length, 'plate')}</span>
          </h3>
          {matches.slice(0, 60).map((entry) => (
            <button
              key={entry.id}
              className="port-item"
              aria-pressed={selection?.key === `plate:${entry.id}`}
              onClick={() => toggle(props, { key: `plate:${entry.id}`, ids: [entry.id], label: entry.name })}
            >
              <i style={{ background: armorThicknessColor(entry.thicknessMm ?? 0) }} />
              <span>{entry.name}</span>
              <strong>{entry.underwaterProtection ? `${Math.round(entry.underwaterProtection.damageReduction * 100)}%` : `${format(entry.thicknessMm ?? 0, 1)} mm`}</strong>
            </button>
          ))}
          {matches.length > 60 && <p className="port-groups-more">and {plural(matches.length - 60, 'more plate')}. Narrow the search.</p>}
          {!matches.length && <p className="port-groups-more">No plate matches. Try a shorter name.</p>}
        </div>
      ) : (
        <div className="port-groups">
          <h3 className="port-eyebrow">
            By zone, thickest first <span>{plural(zones.length, 'zone')} · {plural(plates, 'surface')}</span>
          </h3>
          {zones.map((z) => {
            const open = zoneId === z.id;
            return (
              <div key={z.id} className="port-group" data-open={open}>
                <button
                  aria-expanded={open}
                  aria-pressed={selection?.key === `zone:${z.id}`}
                  onClick={() => toggle(props, { key: `zone:${z.id}`, ids: z.entryIds, label: z.label })}
                  data-help-title={z.label}
                  data-help={`${z.help} ${spanText(z.span)} from the bow.`}
                >
                  <i style={{ background: zoneColor(z) }} />
                  <b>{z.label}</b>
                  <small>
                    {plural(z.entryIds.length, 'surface')}
                    {z.materials.length ? ` · ${z.materials.join(' · ')}` : ''}
                  </small>
                  <strong>{zoneReading(z)}</strong>
                </button>
                {open && z.thicknesses.length > 1 && (
                  <div className="port-group-items">
                    {z.thicknesses.map((t) => {
                      const key = `zone:${z.id}:${t.mm}`;
                      return (
                        <button
                          key={t.mm}
                          className="port-item"
                          aria-pressed={selection?.key === key}
                          onClick={() => props.onSelect(selection?.key === key ? { key: `zone:${z.id}`, ids: z.entryIds, label: z.label } : { key, ids: t.entryIds, label: `${z.label} · ${format(t.mm, t.mm % 1 ? 1 : 0)} mm` })}
                        >
                          <i style={{ background: armorThicknessColor(t.mm) }} />
                          <span>{format(t.mm, t.mm % 1 ? 1 : 0)} mm</span>
                          <strong>{plural(t.entryIds.length, 'surface')}</strong>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/* ---------- Equipment ---------- */

const groupColor = (group: EquipmentGroup) => INSPECTION_COLORS[group.kind];
function EquipmentTab(props: TabProps) {
  const { definition, selection } = props;
  const groups = useMemo(() => equipmentGroups(definition), [definition]);
  const [open, setOpen] = useState<string>();
  const selectedIds = useMemo(() => new Set(selection?.ids), [selection]);
  const marks = useMemo(
    () => groups.flatMap((group) => group.items.map((item) => ({ y: item.y, z: item.z, color: groupColor(group), on: selectedIds.has(item.id) }))),
    [groups, selectedIds],
  );
  return (
    <>
      <ProfileView definition={definition} armor={false} marks={marks} />
      <div className="port-groups">
        <h3 className="port-eyebrow">
          Damageable equipment <span>{plural(groups.reduce((n, g) => n + g.items.length, 0), 'module')} in {plural(groups.length, 'group')}</span>
        </h3>
        {groups.map((group) => {
          const expanded = open === group.id;
          const hp = [...new Set(group.items.map((item) => item.hp))];
          return (
            <div key={group.id} className="port-group" data-open={expanded}>
              <button
                aria-expanded={expanded}
                aria-pressed={selection?.key === `group:${group.id}`}
                onClick={() => {
                  setOpen(expanded && selection?.key === `group:${group.id}` ? undefined : group.id);
                  toggle(props, { key: `group:${group.id}`, ids: group.entryIds, label: group.label });
                }}
                data-help-title={group.label}
                data-help={group.help}
              >
                <i style={{ background: groupColor(group) }} />
                <b>{group.label}</b>
                <small>{group.summary}</small>
                <strong>
                  {group.items.length}
                  <small>{hp.length === 1 ? `${format(hp[0])} HP each` : `${format(Math.min(...hp))}–${format(Math.max(...hp))} HP`}</small>
                </strong>
              </button>
              {expanded && (
                <div className="port-group-items">
                  {group.items.map((item) => (
                    <button
                      key={item.id}
                      className="port-item"
                      aria-pressed={selection?.key === `item:${item.id}`}
                      onClick={() => props.onSelect(selection?.key === `item:${item.id}` ? { key: `group:${group.id}`, ids: group.entryIds, label: group.label } : { key: `item:${item.id}`, ids: [item.id], label: item.name })}
                    >
                      <span>
                        {item.name}
                        <small>{item.where}</small>
                      </span>
                      <strong>{format(item.hp)} HP</strong>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ---------- Flooding ---------- */

function FloodingTab(props: TabProps) {
  const { definition, selection } = props;
  const spaces = useMemo(() => floodingSpaces(definition), [definition]);
  const entries = useMemo(() => modeEntries(definition, 'compartments'), [definition]);
  const [showMinor, setShowMinor] = useState(false);
  const selectedIds = useMemo(() => new Set(selection?.ids), [selection]);
  const boxes = useMemo(() => {
    const most = Math.max(1, ...entries.map((entry) => entry.capacityM3 ?? 0));
    return entries.map((entry) => {
      const { y, z } = profilePoint(entry);
      return { z0: z - entry.size[2] / 2, z1: z + entry.size[2] / 2, y0: y - entry.size[1] / 2, y1: y + entry.size[1] / 2, fill: (entry.capacityM3 ?? 0) / most, on: selectedIds.has(entry.id) };
    });
  }, [entries, selectedIds]);
  const total = spaces.reduce((n, space) => n + space.capacityM3, 0),
    pumps = spaces.reduce((n, space) => n + space.pumpM3PerMinute, 0);
  const major = spaces.filter((space) => !space.minor),
    minor = spaces.filter((space) => space.minor);
  const selected = spaces.find((space) => selectedIds.size === 1 && selectedIds.has(space.id));
  const row = (space: FloodingSpace): ReactNode => (
    <button
      key={space.id}
      className="port-space"
      aria-pressed={selectedIds.size === 1 && selectedIds.has(space.id)}
      onClick={() => toggle(props, { key: `space:${space.id}`, ids: [space.id], label: space.name })}
      data-help-title={space.name}
      data-help={`${format(space.capacityM3)} m³, ${spanText(space.span)} from the bow.${space.pumpM3PerMinute ? ` A fixed pump clears ${format(space.pumpM3PerMinute, 1)} m³ a minute.` : ' No fixed pump.'}`}
    >
      <i style={{ opacity: 0.35 + (0.65 * space.capacityM3) / Math.max(1, ...major.map((s) => s.capacityM3)) }} />
      <b>{space.name}</b>
      <small>
        {spanText(space.span)}
        {space.holds ? ` · ${space.holds}` : ''}
        {space.pumpM3PerMinute > 0 && <span className="port-space-pump"> · pump {format(space.pumpM3PerMinute, 1)} m³/min</span>}
      </small>
      <strong>
        {format(space.capacityM3)}
        <small>m³</small>
      </strong>
    </button>
  );
  return (
    <>
      <ProfileView
        definition={definition}
        armor={false}
        boxes={boxes}
        span={selected && { from: selected.span[0], to: selected.span[1], label: `${selected.name} · ${spanText(selected.span)}` }}
      />
      <div className="port-groups">
        <h3 className="port-eyebrow">
          Bow to stern <span>{format(total)} m³ · pumps {format(pumps, 1)} m³/min</span>
        </h3>
        {major.map(row)}
        {minor.length > 0 && (
          <>
            <button className="port-space port-space-minor" aria-expanded={showMinor} onClick={() => setShowMinor(!showMinor)}>
              <Icon name="chevron" size={14} />
              <b>{plural(minor.length, 'small space')}</b>
              <small>under 100 m³ each</small>
            </button>
            {showMinor && minor.map(row)}
          </>
        )}
      </div>
    </>
  );
}
