import { expect, test } from 'bun:test';
import { PerspectiveCamera } from 'three/webgpu';
import { CombatSimulation } from '../simulation/combat';
import { shipPreset } from '../ships/presets';
import type { Vec3 } from '../ships/blueprint';
import type { Torpedo } from './session/elements';
import { runClock, torpedoAimState, torpedoLead, type LeadContact } from './torpedoLead';
import { torpedoSightReadout, TorpedoAimIndicators } from './TorpedoAimIndicators';
import { TorpedoMarkers } from './TorpedoMarkers';

const origin: Vec3 = [0, 0, 0];
// North is -z. A target 2 km north steaming east at 12 m/s, torpedoes at 27 m/s.
const crossing: LeadContact = { id: 'enemy-1', position: [0, 0, -2000], velocity: [12, 0, 0], lengthM: 200 };

test('the lead is where a torpedo launched now meets the target, and the swing turns the sight onto it', () => {
  const lead = torpedoLead(origin, [0, 0, -2000], [crossing], 27, 9000)!;
  expect(lead.contactId).toBe('enemy-1');
  // The meeting point is on the target's course, and both arrive together.
  expect(lead.point[2]).toBeCloseTo(-2000, 6);
  expect(lead.point[0]).toBeCloseTo(12 * lead.seconds, 6);
  expect(Math.hypot(lead.point[0], lead.point[2])).toBeCloseTo(27 * lead.seconds, 6);
  // Aimed at the hull itself the sight is short of the lead, which lies to the right.
  expect(lead.swing).toBeGreaterThan(0);
  expect(lead.swing).toBeCloseTo(Math.atan2(lead.point[0], 2000), 10);
  expect(lead.onSolution).toBe(false);
  const solved = torpedoLead(origin, lead.point, [crossing], 27, 9000)!;
  expect(solved.swing).toBeCloseTo(0, 10);
  expect(solved.onSolution).toBe(true);
  // The window opens from the meeting point to the courses that meet her stern and her bow.
  expect(lead.course).toBeCloseTo(Math.atan2(lead.point[0], 2000), 10);
  expect(lead.distance).toBeCloseTo(27 * lead.seconds, 6);
  expect(lead.window[0]).toBeLessThan(0); expect(lead.window[1]).toBeGreaterThan(0);
  expect(lead.window[1] - lead.window[0]).toBeGreaterThan(Math.atan2(150, lead.distance));
  expect(lead.window[1] - lead.window[0]).toBeLessThan(Math.atan2(260, lead.distance));
  const bow: Vec3 = [Math.sin(lead.course + lead.window[1] * .9) * 2000, 0, -Math.cos(lead.course + lead.window[1] * .9) * 2000];
  expect(torpedoLead(origin, bow, [crossing], 27, 9000)!.onSolution).toBe(true);
  const ahead: Vec3 = [Math.sin(lead.course + lead.window[1] * 1.2) * 2000, 0, -Math.cos(lead.course + lead.window[1] * 1.2) * 2000];
  expect(torpedoLead(origin, ahead, [crossing], 27, 9000)!.onSolution).toBe(false);
  // End-on she offers a narrow window; stopped, one that allows for any heading.
  const endOn = torpedoLead(origin, [0, 0, -2000], [{ ...crossing, velocity: [0, 0, 12] }], 27, 9000)!;
  expect(endOn.window[1] - endOn.window[0]).toBeLessThan(lead.window[1] - lead.window[0]);
  const stopped = torpedoLead(origin, [0, 0, -2000], [{ ...crossing, velocity: [0, 0, 0] }], 27, 9000)!;
  expect(stopped.window).toEqual([-Math.atan2(60, 2000), Math.atan2(60, 2000)]);
  // A sight on the far side of the lead is told to come back left.
  expect(torpedoLead(origin, [2000, 0, -2000], [crossing], 27, 9000)!.swing).toBeLessThan(0);
});

test('the sight leads the contact nearest it and ignores ones it cannot reach or is not looking at', () => {
  const west: LeadContact = { id: 'enemy-2', position: [-1500, 0, -1500], velocity: [0, 0, 0] };
  expect(torpedoLead(origin, [-1400, 0, -1500], [crossing, west], 27, 9000)!.contactId).toBe('enemy-2');
  expect(torpedoLead(origin, [100, 0, -2000], [crossing, west], 27, 9000)!.contactId).toBe('enemy-1');
  expect(torpedoLead(origin, [0, 0, -2000], [crossing], 27, 1500)).toBeUndefined();
  expect(torpedoLead(origin, [0, 0, 2000], [crossing], 27, 9000)).toBeUndefined();
  // Faster than the torpedo and opening: no meeting point at all.
  expect(torpedoLead(origin, [0, 0, -2000], [{ id: 'enemy-3', position: [0, 0, -2000], velocity: [0, 0, -40] }], 27, 9000)).toBeUndefined();
});

test('a destroyer sight reads the meeting with a crossing cruiser and says why a launch is held', () => {
  const sim = new CombatSimulation(shipPreset('fletcher'));
  const actor = sim.player, aim: Vec3 = [3000, .5, 0];
  const contact: LeadContact = { id: 'enemy-1', position: [3000, 0, 0], velocity: [0, 0, -10], lengthM: 200 };
  const state = torpedoAimState(actor, actor.motion, aim, [contact]);
  expect(state.sectors.length).toBeGreaterThan(0);
  const solution = state.solution!, lead = state.lead!;
  expect(solution.speed).toBe(state.sectors[0].speed);
  expect(lead.point[2]).toBeLessThan(0);
  // A launcher still swinging onto the course holds the shot.
  expect(torpedoSightReadout(state)).toEqual({ clock: runClock(lead.seconds), range: `${(lead.distance / 1000).toFixed(2)} km`, status: 'TRAINING', tone: 'waiting' });
  const ready = (aimed: typeof state) => ({ ...aimed, solution: { ...aimed.solution!, status: 'ready' as const } });
  expect(torpedoSightReadout(ready(state))).toMatchObject({ status: '', tone: 'ready' });
  expect(torpedoSightReadout(ready(torpedoAimState(actor, actor.motion, lead.point, [contact])))).toMatchObject({ status: 'ON TARGET', tone: 'solved' });
  // With nothing to lead the sight gives the full run.
  expect(torpedoSightReadout(ready(torpedoAimState(actor, actor.motion, aim, [])))).toEqual({ clock: runClock(solution.range / solution.speed), range: `${(solution.range / 1000).toFixed(1)} km`, status: '', tone: 'ready' });
  // A contact under the sight that the torpedoes cannot meet says why.
  const far = torpedoAimState(actor, actor.motion, aim, [{ ...contact, position: [solution.range + 3000, 0, 0], velocity: [0, 0, 0] }]);
  expect(far.lead).toBeUndefined();
  expect(torpedoSightReadout(ready(far))).toMatchObject({ status: 'BEYOND RUN', tone: 'caution' });
  const close = torpedoAimState(actor, actor.motion, aim, [{ ...contact, position: [solution.origin[0] + 60, 0, solution.origin[2]], velocity: [0, 0, 0] }]);
  expect(torpedoSightReadout(ready(close))).toMatchObject({ status: 'INSIDE ARMING RUN', tone: 'caution' });
  expect(torpedoSightReadout({ ...state, solution: { ...solution, status: 'out-of-arc' } })).toMatchObject({ status: 'OUT OF ARC', tone: 'blocked' });
  expect(torpedoSightReadout({ ...state, solution: { ...solution, status: 'reloading', reload: 23.2 } })).toMatchObject({ status: 'RELOAD 0:23', tone: 'waiting' });
  expect(torpedoSightReadout({ sectors: [] })).toBeUndefined();
});

test('running time reads as minutes and seconds', () => {
  expect(runClock(46.4)).toBe('0:46');
  expect(runClock(59.6)).toBe('1:00');
  expect(runClock(96)).toBe('1:36');
});

class Element {
  children: Element[] = [];
  className = ''; textContent = ''; hidden = false;
  style: Record<string, string> & { setProperty(name: string, value: string): void } = Object.assign({} as Record<string, string>, { setProperty(this: Record<string, string>, name: string, value: string) { this[name] = value; } });
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  classList = { toggle: (name: string, on: boolean) => { this.toggled.set(name, on); } };
  toggled = new Map<string, boolean>();
  append(...children: Element[]) { this.children.push(...children); }
  appendChild(child: Element) { this.append(child); }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  remove() {}
  find(name: string): Element | undefined { return this.className === name ? this : this.children.map(child => child.find(name)).find(Boolean); }
}
function withDocument(run: (host: Element) => void): void {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => new Element() } });
  try { run(new Element()); } finally {
    if (original) Object.defineProperty(globalThis, 'document', original);
    else Reflect.deleteProperty(globalThis, 'document');
  }
}
function lookingNorth(): PerspectiveCamera {
  const camera = new PerspectiveCamera(52, 16 / 9, .5, 60000);
  camera.position.set(0, 40, 344); camera.lookAt(0, 0, -2000);
  camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  return camera;
}

test('the readout sits either side of the sight and an edge chevron points to a lead out of view', () => withDocument(host => {
  const indicators = new TorpedoAimIndicators(host as unknown as HTMLElement);
  indicators.resize(1600, 900);
  const layer = host.children[0], edge = layer.find('torpedo-lead-edge')!;
  const lead = torpedoLead(origin, [0, 0, -2000], [crossing], 27, 9000)!;
  const state = { sectors: [], solution: { origin, status: 'ready' as const, distance: 2000, runSeconds: 2000 / 27, range: 9000, speed: 27, reload: 0 }, lead };
  indicators.update(state, lookingNorth(), true);
  expect(layer.hidden).toBe(false);
  expect(layer.find('torpedo-aim-clock')!.textContent).toBe(runClock(lead.seconds));
  expect(layer.find('torpedo-aim-range')!.textContent).toBe(`${(lead.distance / 1000).toFixed(2)} km`);
  expect(layer.find('torpedo-aim-status')!.textContent).toBe('');
  expect(edge.hidden).toBe(true);
  // A meeting point well off the beam of the view is out of frame.
  const abeam = torpedoLead(origin, [1800, 0, -1000], [{ ...crossing, position: [2400, 0, -700] }], 27, 9000)!;
  indicators.update({ ...state, lead: abeam }, lookingNorth(), true);
  expect(edge.hidden).toBe(false);
  expect(edge.dataset.turn).toBe('right');
  expect(edge.textContent).toBe(`LEAD ${Math.round(abeam.swing * 180 / Math.PI)}°`);
  indicators.update({ ...state, lead: undefined }, lookingNorth(), true);
  expect(edge.hidden).toBe(true);
  indicators.update(undefined, lookingNorth(), true);
  expect(layer.hidden).toBe(true);
}));

test('chevrons follow torpedoes in view and take the colour of the side that launched them', () => withDocument(host => {
  const markers = new TorpedoMarkers(host as unknown as HTMLElement);
  markers.resize(1600, 900);
  const layer = host.children[0];
  const torpedo = (id: number, ownerId: string, position: Vec3) => ({ id, ownerId, position, velocity: [0, 0, -27], distance: 500, age: 10, weapon: { diameterM: .53, lengthM: 7, speed: 25 } }) as Torpedo;
  const running = [torpedo(1, 'friendly-1', [0, -3, -900]), torpedo(2, '', [300, -3, -1200]), torpedo(3, 'friendly-1', [0, -3, 4000])];
  markers.update(running, new Set(['friendly-1']), lookingNorth(), true);
  expect(layer.hidden).toBe(false);
  // The torpedo astern of the camera gets no mark.
  expect(layer.children.map(mark => [mark.className, mark.hidden])).toEqual([['torpedo-marker', false], ['torpedo-marker torpedo-marker-enemy', false]]);
  expect(layer.children[0].style.transform).toMatch(/^translate\(800\.0px, /);
  markers.update([running[1]], new Set(['friendly-1']), lookingNorth(), true);
  expect(layer.children.map(mark => [mark.className, mark.hidden])).toEqual([['torpedo-marker torpedo-marker-enemy', false], ['torpedo-marker torpedo-marker-enemy', true]]);
  markers.update([], new Set(), lookingNorth(), true);
  expect(layer.hidden).toBe(true);
}));
