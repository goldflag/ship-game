import { expect, test } from 'bun:test';
import { HeadlessSession } from '../../../scripts/multiplayer/headless-session';
import pveRules from '../../../assets/gameplay/pve-mission.v1.json';
import type { MissionRules } from '../../multiplayer/generated/MissionRules';

test('real team snapshots carry sampled coverage and observed condition without creating enemy actors', async () => {
  const session = await HeadlessSession.create({ playerShipId:'fletcher',friendlyBots:[],enemies:[{shipId:'fletcher',aiLevel:'static'}],spawnDistance:2000,weather:'clear',missionRules:pveRules as MissionRules });
  try {
    session.advance(.1,{throttle:0,rudder:0},{aim:session.aimAt(),battery:'main',fire:false});
    expect(session.actors).toHaveLength(1);
    expect(session.target).toBeUndefined();
    expect(session.reconCoverage?.target).toBe('surface-vessel');
    expect(session.reconCoverage!.cells.length).toBeGreaterThan(0);
    expect(session.reconCoverage!.cells.every(cell=>cell.lastObservedTick<=session.tick)).toBe(true);
    expect(session.observationTracks[0].visibleCondition).toEqual({observedTick:0,fire:false,heavySmoke:false,listing:false,sinking:false});
    const raw = JSON.parse(session.runtime.snapshot());
    expect(JSON.stringify(raw)).not.toContain('enemy-1');
    expect(raw.contacts[0].health).toBeUndefined();
    expect(raw.observedShips[0].health).toBeGreaterThan(0);
    expect(raw.contacts[0].inventory).toBeUndefined();
    expect(raw.contacts[0].orders).toBeUndefined();
    delete raw.reconCoverage;
    session.applyRaw(JSON.stringify(raw));
    expect(session.reconCoverage).toBeUndefined();
  } finally { session.dispose(); }
});

test('real PvE WASM aircraft sightings reach the renderer without enemy carriers or combat state', async () => {
  const session = await HeadlessSession.createPve({ version: 1, seed: 396076824, mapId: 'north-atlantic', weather: 'clear', difficulty: 'normal',
    ships: [{ id: 'player', presetId: 'fletcher', groupId: 'front' }, { id: 'carrier', presetId: 'enterprise-cv6', groupId: 'front' }],
    groups: [{ id: 'front', name: 'Vanguard', station: 'front' }] });
  try {
    for (let batch = 0; batch < 2400 && !session.observedAircraft.length; batch++) {
      session.runtime.step(6); session.applyRaw(session.runtime.snapshot());
    }
    expect(session.observedAircraft.length).toBeGreaterThan(0);
    const plane = session.observedAircraft[0];
    expect(plane.id).toMatch(/^contact-/);
    expect(plane.modelId).toBeTruthy();
    expect(plane.observers).toContain('player');
    expect(plane.controls.propeller).toBeNumber();
    expect(session.actors.every(a => a.team === 'friendly')).toBe(true);
    expect(session.aircraft.every(p => p.team === 'friendly')).toBe(true);
    const raw = JSON.parse(session.runtime.snapshot());
    expect(JSON.stringify(raw.observedAircraft)).not.toContain('enemy-1');
    expect(raw.observedAircraft[0].hp).toBeUndefined();
    expect(raw.observedAircraft[0].health).toBeGreaterThan(0);
    expect(raw.observedAircraft[0].ownerId).toBeUndefined();
    delete raw.observedAircraft;
    session.applyRaw(JSON.stringify(raw));
    expect(session.observedAircraft).toEqual([]);
  } finally { session.dispose(); }
}, 20000);
