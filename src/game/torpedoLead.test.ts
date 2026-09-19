import { expect, test } from 'bun:test';
import { PerspectiveCamera } from 'three/webgpu';
import { CombatSimulation } from '../simulation/combat';
import { shipPreset } from '../ships/presets';
import type { Vec3 } from '../ships/blueprint';
import type { Torpedo } from './session/elements';
import { runClock, torpedoAimState, torpedoLead, type LeadContact } from './torpedoLead';
import { leadPostRise, torpedoSightReadout, TorpedoAimIndicators } from './TorpedoAimIndicators';
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

test('a destroyer sight reports the course under it and the lead on a crossing cruiser', () => {
  const sim = new CombatSimulation(shipPreset('fletcher'));
  const actor = sim.player, aim: Vec3 = [3000, .5, 0];
  const contact: LeadContact = { id: 'enemy-1', position: [3000, 0, 0], velocity: [0, 0, -10], lengthM: 200 };
  const state = torpedoAimState(actor, actor.motion, aim, [contact]);
  expect(state.sectors.length).toBeGreaterThan(0);
  const solution = state.solution!;
  expect(solution.distance).toBeCloseTo(Math.hypot(aim[0] - solution.origin[0], aim[2] - solution.origin[2]), 8);
  expect(solution.runSeconds).toBeCloseTo(solution.distance / state.sectors[0].speed, 8);
  expect(state.lead!.point[2]).toBeLessThan(0);
  const readout = torpedoSightReadout(state)!;
  expect(readout.range).toBe(`${(solution.distance / 1000).toFixed(1)} km`);
  expect(readout.run).toBe(`RUN ${runClock(solution.runSeconds)}`);
  expect(readout.swing).toMatch(/°$/);
  expect(torpedoSightReadout(torpedoAimState(actor, actor.motion, state.lead!.point, [contact]))!).toMatchObject({ swing: 'ON', tone: 'solved' });
  // Inside the arming run the sight says why nothing will happen.
  const close = torpedoAimState(actor, actor.motion, [solution.origin[0] + 40, .5, solution.origin[2]], []);
  expect(torpedoSightReadout(close)).toMatchObject({ run: 'INSIDE ARMING RUN', tone: 'blocked', swing: '' });
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

test('the lead post stands on the meeting point and the readout says which way to swing', () => withDocument(host => {
  const indicators = new TorpedoAimIndicators(host as unknown as HTMLElement);
  indicators.resize(1600, 900);
  const layer = host.children[0], post = layer.find('torpedo-lead')!;
  const lead = torpedoLead(origin, [0, 0, -2000], [crossing], 27, 9000)!;
  const state = { sectors: [], solution: { origin, status: 'ready' as const, distance: 2000, runSeconds: 2000 / 27, range: 9000 }, lead };
  indicators.update(state, lookingNorth(), true);
  expect(layer.hidden).toBe(false);
  expect(layer.find('torpedo-aim-range')!.textContent).toBe('2.0 km');
  expect(layer.find('torpedo-aim-run')!.textContent).toBe('RUN 1:14');
  expect(layer.find('torpedo-aim-swing')!.dataset.turn).toBe('right');
  expect(post.hidden).toBe(false);
  const [, x] = /translate\(([\d.]+)px/.exec(post.style.transform)!;
  expect(Number(x)).toBeGreaterThan(800);
  expect(layer.find('torpedo-lead-caption')!.textContent).toBe('LEAD');
  expect(layer.find('torpedo-lead-clock')!.textContent).toBe(runClock(lead.seconds));
  expect(post.style['--lead-rise']).toBe('48px');
  // Led by little, the post would stand in the target's own name tag: it grows past it.
  const y = Number(/, ([\d.]+)px\)/.exec(post.style.transform)![1]);
  indicators.update(state, lookingNorth(), true, id => id === 'enemy-1' ? { x: Number(x) + 20, top: y - 70, bottom: y - 24, halfWidth: 72 } : undefined);
  expect(post.style['--lead-rise']).toBe('82px');
  expect(post.toggled.get('torpedo-lead-crowded')).toBe(true);
  // No contact to lead: the readout stays, the post and swing go.
  indicators.update({ ...state, lead: undefined }, lookingNorth(), true);
  expect(post.hidden).toBe(true);
  expect(layer.find('torpedo-aim-swing')!.hidden).toBe(true);
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

test('the lead post keeps its height unless it would stand in the target name tag', () => {
  const tag = { x: 500, top: 330, bottom: 376, halfWidth: 72 };
  expect(leadPostRise({ x: 500, y: 400 })).toBe(48);
  expect(leadPostRise({ x: 800, y: 400 }, tag)).toBe(48);
  expect(leadPostRise({ x: 520, y: 400 }, tag)).toBe(82);
  // A tag far above or below the post's head is no obstacle.
  expect(leadPostRise({ x: 520, y: 600 }, tag)).toBe(48);
});
