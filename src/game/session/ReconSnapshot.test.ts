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
    expect(raw.contacts[0].inventory).toBeUndefined();
    expect(raw.contacts[0].orders).toBeUndefined();
    delete raw.reconCoverage;
    session.applyRaw(JSON.stringify(raw));
    expect(session.reconCoverage).toBeUndefined();
  } finally { session.dispose(); }
});
