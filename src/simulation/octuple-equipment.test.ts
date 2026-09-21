import { expect, test } from 'bun:test';
import blueprint from '../../assets/ships/king-george-v/blueprint.json';
// Retained KGV octuple prototype: its compiled definition and the node tree (no meshes) of its exported model.
import prototype from './fixtures/octuple-prototype/definition.json';
import prototypeNodes from './fixtures/octuple-prototype/model-nodes.json';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ShipView } from '../game/ShipView';
import type { ShipDefinition } from '../ships/blueprint';
import catalog from '../../assets/parts/guns.json';
import { barrelIds, compileShip } from '../ships/blueprint';
import { CombatSimulation } from './combat';
import { muzzleLocal, muzzleCenterLocal } from './weapons';

const fixture = () => ({...blueprint,mounts:[...blueprint.mounts,...prototype.mounts.filter(m=>m.id.startsWith('pom-pom-')).map(({weapon: _weapon,...m})=>m)]});
const def = () => compileShip(fixture(), catalog);
test('octuple muzzles preserve a four-by-two grid through common elevation and traverse', () => {
  const mount = def().mounts.find(m => m.id === 'pom-pom-1')!;
  expect(barrelIds(mount.weapon)).toEqual(['lower-left-outer', 'lower-left', 'lower-right', 'lower-right-outer', 'upper-left-outer', 'upper-left', 'upper-right', 'upper-right-outer']);
  for (const train of [-1.4, 0, .43, 2.1]) for (const elevation of [-.17, 0, .4, 1.396]) {
    const pose = { train, elevation }, muzzles = barrelIds(mount.weapon).map((_,i) => muzzleLocal(mount, pose, i));
    const distance = (a: number,b: number) => Math.hypot(...muzzles[a].map((v,i)=>v-muzzles[b][i]));
    for (let i=0;i<4;i++) expect(distance(i,i+4)).toBeCloseTo(mount.weapon.barrelVerticalSpacing!,10);
    for (const i of [0,1,2,4,5,6]) expect(distance(i,i+1)).toBeCloseTo(mount.weapon.barrelSpacing,10);
    const center = muzzleCenterLocal(mount,pose);
    for (let axis=0;axis<3;axis++) expect(center[axis]).toBeCloseTo(muzzles.reduce((n,p)=>n+p[axis]/8,0),10);
  }
  expect(() => compileShip(fixture(),{...catalog,parts:catalog.parts.map(p=>p.id===mount.partId?{...p,barrelVerticalSpacing:undefined}:p)})).toThrow('barrelVerticalSpacing');
});

test('retained octuple export sockets agree with CPU muzzle poses at intermediate train, elevation and recoil', async () => {
  const model=await new GLTFLoader().parseAsync(JSON.stringify(prototypeNodes),'');
  const definition=prototype as unknown as ShipDefinition,sim=new CombatSimulation(definition),view=new ShipView(model.scene,definition,sim.player);
  expect(view.muzzleErrors()).toHaveLength(58);
  for(const train of [-1,-.43,0,.27,1])for(const elevation of [0,.37,.72,1])for(const recoil of [0,.4,1]) {
    Object.assign(sim.player.motion,{x:341,y:-1.5,z:-837,heading:2.6,pitch:-.08,roll:.13});
    sim.player.mounts.forEach((s,i)=>{const w=definition.mounts[i].weapon;Object.assign(s,{train:train*w.traverseDeg*Math.PI/180,elevation:(w.elevationMinDeg+elevation*(w.elevationMaxDeg-w.elevationMinDeg))*Math.PI/180,recoil});});
    view.update();expect(Math.max(...view.muzzleErrors())).toBeLessThan(.025);
  }
});
