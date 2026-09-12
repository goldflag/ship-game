import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FlightLine, type FlightLineCarrier, type FlightLineFlight } from '../../src/ui/FlightLine';
import type { Aircraft } from '../../src/simulation/aircraft';
import type { AirWingTelemetry, FlightSummary } from '../../src/simulation/airTelemetry';
import '../../src/ui/styles.css';
import '@fontsource/barlow/latin-400.css';
import '@fontsource/barlow-condensed/latin-500.css';

/* The flight line's group boxes at a fixed 90px, with the longest real notices
 * ('Covering a threatened wingman', 'Evading fighter') in the row. Those used to
 * widen the box's auto grid column and paint over the neighbouring groups.
 * ?statuses=short renders the short labels instead, for comparison. */
const query = new URLSearchParams(location.search);
const long = query.get('statuses') !== 'short';

const NOTICES = long
  ? ['Landing', 'Engaging', 'Covering a threatened wingman', 'Evading fighter', 'Evading fighter', 'Lost', 'Lost', 'En route', 'Lost']
  : ['Landing', 'Engaging', 'En route', 'Lost', 'Lost', 'Lost', 'Lost', 'En route', 'Lost'];
const SURVIVING = [3, 6, 4, 5, 6, 0, 0, 2, 0], TOTAL = [6, 6, 4, 6, 6, 4, 6, 6, 4];
const ROLES = ['fighter', 'fighter', 'fighter', 'dive-bomber', 'dive-bomber', 'dive-bomber', 'torpedo-bomber', 'torpedo-bomber', 'torpedo-bomber'] as const;
const NAMES = ['Fighter 1', 'Fighter 2', 'Fighter 3', 'Dive 1', 'Dive 2', 'Dive 3', 'Torpedo 1', 'Torpedo 2', 'Torpedo 3'];

const plane = (id: string, role: string, alive: boolean): Aircraft => ({
  id, flightId: '', squadronId: '', role, modelId: 'a6m2', phase: alive ? 'cruise' : 'lost',
  hp: alive ? 90 : 0, ammo: alive ? 3 : 0, payload: alive, position: [0, 0, 0], velocity: [0, 0, 0],
  heading: 0, flightTime: 100, timer: 0, kills: 0,
} as unknown as Aircraft);

const flights: FlightLineFlight[] = NAMES.map((name, i) => ({
  id: `f${i}`, name, squadronId: `s${i}`, role: ROLES[i], order: { kind: 'patrol', point: [0, 0] },
  active: SURVIVING[i] > 0, status: SURVIVING[i] > 0 ? 'on-mission' : 'lost',
  total: TOTAL[i], surviving: SURVIVING[i], airborne: SURVIVING[i], hp: 90,
  armed: SURVIVING[i], enduranceSeconds: 1793 + i * 5, rearmSeconds: 0,
  position: [0, 0, 0], destination: [0, 0, 0], activity: NOTICES[i], heading: 0, route: [],
  notice: i === 2 ? NOTICES[i] : undefined, aircraftIds: [],
  ownerId: 'akagi', carrierName: 'Akagi',
} as unknown as FlightLineFlight));

const wing = { groups: flights as unknown as FlightSummary[], onDeck: 4, deckCapacity: 12, inHangar: 8, deck: undefined, recovery: undefined } as unknown as AirWingTelemetry;
const carriers: FlightLineCarrier[] = [{ id: 'akagi', name: 'Akagi', hull: 0.82, kn: 24, order: 'Holding station', wing }];

function Review() {
  const [selected, setSelected] = useState<string[]>([]);
  const [hover, setHover] = useState<string | undefined>();
  return <FlightLine carriers={carriers} flights={flights} planesOf={f => Array.from({ length: f.total }, (_, i) => plane(`${f.id}/${i}`, f.role, i < f.surviving))}
    selectedIds={selected} hoverId={hover} actionable hasBoundary={false}
    search={{ radius: 4000, altitude: 'medium', policy: 'report', setRadius: () => {}, setAltitude: () => {}, setPolicy: () => {} }}
    onHover={setHover} onSelect={id => setSelected(s => s.includes(id) ? [] : [id])} onVerb={() => {}}
    onFollowLead={() => {}} canFollow={() => true} onCentre={() => {}} onService={() => {}}
    onDeckPolicy={() => {}} onPrioritize={() => {}} onCancelTask={() => {}} onToggleDeck={() => {}} onClose={() => {}}/>;
}
createRoot(document.querySelector('#root')!).render(<Review/>);
