import { hydrostatics, flotation } from '../../src/simulation/hydrostatics';
import { waterBody, levelAtVolume } from '../../src/simulation/floodwater';
import { createSeaState, seaHeight } from '../../src/simulation/sea';
import { OCEAN_MAPS, mapIslands, islandHeight } from '../../src/maps/catalog';
import { WEATHER_PRESETS } from '../../src/maps/conditions';
import { createMountState, updateMount, muzzleLocal } from '../../src/simulation/weapons';
import { shipPreset } from '../../src/ships/presets';
/** Frozen TS reference scenarios. Regenerate deliberately when mechanics change. */
import { mkdir, writeFile } from 'node:fs/promises';
import { shipPresets } from '../../src/ships/presets';
import { createShipState, stepShip } from '../../src/simulation/ship';
import { ballisticStep, solveDragArc, dispersedSpeed, dispersedDirection } from '../../src/simulation/ballistics';
import { localToWorld, worldToLocal } from '../../src/simulation/geometry';
import { selectEnvironment } from '../../src/simulation/battleRules';
const motion = Object.entries(shipPresets).map(([id, definition]) => {
  const ship = createShipState(id);
  const inputs = [{ ticks: 300, command: { throttle: 1, rudder: 0 } }, { ticks: 600, command: { throttle: .75, rudder: .6 } }, { ticks: 240, command: { throttle: -1, rudder: -.5 } }];
  const checkpoints = inputs.map(input => { for (let i=0;i<input.ticks;i++) stepShip(ship, input.command, definition.handling); return {...ship}; });
  return { id: id, handling: definition.handling, inputs, checkpoints };
});
const ballistic = [0, .001, .02, .2].flatMap(drag => [100, 3000, 15000, 70000].map(range => {
  const from: [number,number,number] = [5,8,2], target: [number,number,number] = [range,.5,-range*.2], speed=820;
  const arc=solveDragArc(from,target,speed,drag);
  const step=ballisticStep(from,[20,40,-300],1/60,drag);
  return {from,target,speed,drag,arc,step};
}));
const pose={x:4,y:2,z:10,heading:.74,roll:-.2,pitch:.1},point:[number,number,number]=[3,10,-70];
const dispersion=[0,1,0xffffffff].flatMap(seed => [0,1,300,0xffffffff].map(shot=>({seed,shot,speed:dispersedSpeed(820,.005,seed,shot),direction:dispersedDirection([0,0,-1],.002,seed,shot)})));
const environments=Array.from({length:100},(_,seed)=>({seed,selection:selectEnvironment(seed,['open-ocean','islands'],['map','clear','storm'])}));
const hydro = Object.keys(shipPresets).map(id => {
  const d = shipPreset(id), r = .21, p = -.013;
  return { id, hydrostatics: hydrostatics(d.hull, -1.2, r, p), flotation: flotation(d.hull, d.hull.massKg / 1025, r, p),
    water: d.compartments.slice(0, 4).map(room => { const volume = room.capacityM3 * .37, body = waterBody(room, volume, r, p); return { id: room.id, body, nextLevel: levelAtVolume(room, body, room.capacityM3 * .68) }; }) };
});
const sea = OCEAN_MAPS.flatMap(map => WEATHER_PRESETS.map(weather => { const state = createSeaState(map.id, weather.id, 73493); return { mapId: map.id, weather: weather.id, state, height: seaHeight(state, 452.5, -320.4, 67.1) }; }));
const terrain = OCEAN_MAPS.flatMap(map => mapIslands(map.id, 5000, 8).map(island => ({ island, points: [[.1,.2],[.54,-.13],[.97,.32],[1.2,-.15]].map(([x,z])=>({ x:island.x+x*island.rx,z:island.z+z*island.rz,height:islandHeight(island,island.x+x*island.rx,island.z+z*island.rz) })) })));
const mounts = Object.keys(shipPresets).map(id => { const definition = shipPreset(id), ship = createShipState(id); ship.heading = .7; ship.roll = -.04; ship.pitch = .01; return { id, ship, states: definition.mounts.map(m => {const state = createMountState(m); for(let i=0;i<120;i++)updateMount(m,state,definition,ship,[3000,.5,-4000],1/60); return {state,muzzle:muzzleLocal(m,state,0)};}) }; });
await mkdir('assets/gameplay/migration' ,{recursive:true});
await writeFile('assets/gameplay/migration/reference.v1.json', JSON.stringify({version:1, hydro, sea, terrain, mounts, motion, ballistic, geometry:{pose,point,world:localToWorld(point,pose),local:worldToLocal(point,pose)},dispersion,environments},null,2)+'\n');
