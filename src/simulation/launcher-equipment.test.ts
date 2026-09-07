import { advanceProjectile } from './projectile';
import { equipmentPose } from './equipmentPose';
import { trainTorpedoLaunchers, tubeSolution } from './torpedoes';
import { updateDepthChargeLauncher } from './depthCharges';
import { expect, test } from 'bun:test';
import fletcher from '../../assets/ships/fletcher/blueprint.json';
import catalog from '../../assets/parts/guns.json';
import { compileShip, type ShipBlueprint } from '../ships/blueprint';
import { CombatSimulation } from './combat';
import { shipContacts, resolveShipContact, type Shell } from './damage';
import { localToWorld } from './geometry';
import { updateCapability } from './stability';
import { launcherAvailable } from './machinery';
import { burstShell } from './burst';

function fixture() {
  const b = structuredClone(fletcher) as unknown as ShipBlueprint;
  const launcher = b.torpedoLaunchers![0];
  const oldOwner=b.modules.find(m=>m.torpedoLauncherId===launcher.id)?.id;
  b.modules=b.modules.filter(m=>m.id!==oldOwner);
  b.localDamage!.regions=b.localDamage!.regions.filter(r=>r.moduleId!==oldOwner);
  b.modules.push({ id: 'launcher-hp', name: 'Forward launcher', kind: 'launcher', placement: 'fixed', torpedoLauncherId: launcher.id, center: [0, 6.6, -2], size: [3.6, 1.2, 7.1], hp: 80, protectionMm: 8, immersionToleranceM: .3 });
  b.torpedoTubes!.filter(t => t.launcherId === launcher.id).forEach(t => t.launcherModuleId = 'launcher-hp');
  b.localDamage!.regions.push({ id: 'launcher-region', name: 'Forward launcher', kind: 'launcher', moduleId: 'launcher-hp', center: [0,6.6,-2], size: [3.6,1.2,7.1], durabilityFraction: .008 });
  const def = compileShip(b, catalog), sim = new CombatSimulation(def);
  Object.assign(sim.player.motion, { x: 0, z: 0, y: 0, heading: 0, pitch: 0, roll: 0 });
  return { b, def, a: sim.player };
}
const shell = (id = 1): Shell => ({ id, ownerId: 'enemy', position: [0,0,0], velocity: [0,0,700], age: 0, penetrationMm: 500, damage: 200, caliberM: .15, visited: [] });

test('launcher hitboxes follow intermediate yaw and apply one equipment and structural owner', () => {
  const { def, a } = fixture();
  for (const train of [0, .4, Math.PI/2, -1.7]) {
    a.torpedoLaunchers![0].train = train;
    const pose = { x: 0, y: 0, z: -2, heading: train, roll: 0, pitch: 0 };
    const from = localToWorld([0,6.6,-5], pose), to = localToWorld([0,6.6,5], pose), shot = shell();
    const hit = shipContacts(shot, from, to, a, def).find(h => h.kind === 'module' && def.modules[h.index].id === 'launcher-hp');
    expect(hit).toBeDefined();
    a.damage.modules.at(-1)!.hp = 80;
    resolveShipContact(shot, hit!, a, def, () => {});
    expect(a.damage.modules.at(-1)!.hp).toBe(0);
    expect(a.damage.regions.at(-1)!.hp).toBeLessThan(a.damage.regions.at(-1)!.maximum);
    expect(a.damage.compartments.every(c => c.breachAreaM2 === 0)).toBe(true);
  }
});

test('protected bursts reach the rotated launcher and permanent owner loss affects fighting strength', () => {
  const { def, a } = fixture();
  a.torpedoLaunchers![0].train = Math.PI/2;
  const shot = shell(); shot.position = [4, 6.6, -2];
  shot.he = { explosiveKg: 20, fragmentPenetrationMm: 100, damage: 300, stockFraction: .5, basis: 'test' };
  burstShell(shot, [a], () => {});
  expect(a.damage.modules.at(-1)!.hp).toBeLessThan(80);
  a.mounts.forEach(m => { m.ammo = 0; m.heAmmo = 0; });
  a.depthChargeLaunchers!.forEach(l => l.ammo = 0);
  a.torpedoTubes!.forEach((t,i) => t.ammo = i === 0 ? 1 : 0);
  a.damage.modules.at(-1)!.hp = 80;
  a.motion.y = -10;
  expect(launcherAvailable(a, def, 'launcher-hp')).toBe(false);
  updateCapability(a, def); expect(a.damage.stability.combatLost).toBe(false);
  a.motion.y = 0; updateCapability(a, def); expect(a.damage.stability.combatLost).toBe(false);
  a.damage.modules.at(-1)!.hp = 0;
  updateCapability(a, def); expect(a.damage.stability.combatLost).toBe(true);
});

test('shared torpedo banks reject inconsistent damage owners', () => {
  const { b } = fixture(); delete b.torpedoTubes![0].launcherModuleId;
  expect(() => compileShip(b, catalog)).toThrow('one damage owner');
});

test('destroyed torpedo banks stop training and disable only their linked tubes', () => {
  const def=compileShip(fletcher,catalog),sim=new CombatSimulation(def),a=sim.player;
  const owner=def.torpedoTubes![0].launcherModuleId!;
  a.damage.modules.find(m=>m.id===owner)!.hp=0;
  const train=a.torpedoLaunchers![0].train;
  trainTorpedoLaunchers(a,()=>[1000,0,0],1);
  expect(a.torpedoLaunchers![0].train).toBe(train);
  expect(a.torpedoLaunchers![1].train).not.toBe(0);
  def.torpedoTubes!.forEach((tube,i)=>tubeSolution(a,tube,a.torpedoTubes![i],[1000,0,0],1/60));
  expect(a.torpedoTubes!.slice(0,5).every(t=>t.status==='disabled')).toBe(true);
  expect(a.torpedoTubes!.slice(5).every(t=>t.status!=='disabled')).toBe(true);
  sim.reset(); expect(a.damage.modules.find(m=>m.id===owner)!.hp).toBeGreaterThan(0);
});

test('a last loaded depth-charge station stays recoverable under immersion but its destruction ends fighting strength', () => {
  const def=compileShip(fletcher,catalog),a=new CombatSimulation(def).player;
  a.mounts.forEach(m=>{m.ammo=0;m.heAmmo=0;}); a.torpedoTubes!.forEach(t=>t.ammo=0);
  a.depthChargeLaunchers!.forEach((l,i)=>l.ammo=i===0?1:0);
  const l=def.depthChargeLaunchers![0],state=a.depthChargeLaunchers![0],owner=a.damage.modules.find(m=>m.id===l.launcherModuleId)!;
  a.motion.y=-10; updateDepthChargeLauncher(a,l,state,1/60); updateCapability(a,def);
  expect(state.status).toBe('disabled');expect(a.damage.stability.combatLost).toBe(false);
  a.motion.y=0; updateDepthChargeLauncher(a,l,state,1/60);expect(state.status).toBe('ready');
  owner.hp=0;updateDepthChargeLauncher(a,l,state,1/60);updateCapability(a,def);
  expect(state.status).toBe('disabled');expect(state.ammo).toBe(1);expect(a.damage.stability.combatLost).toBe(true);
});

test('an armed stop follows the torpedo bank until its delayed burst', () => {
  const {def,a}=fixture(),owner=def.modules.at(-1)!;
  // A weak armed round lodges on the incoming face rather than passing inside.
  const shot=shell(8);shot.penetrationMm=5;shot.ap={armingResistanceMm:1,fuzeDelaySeconds:.1,explosiveKg:.2,fragmentPenetrationMm:1,basis:'test'};
  const from: [number,number,number]=[0,6.6,-8],to: [number,number,number]=[0,6.6,-2];
  shot.position=from;
  const contact=shipContacts(shot,from,to,a,def).find(h=>h.kind==='module'&&h.index===def.modules.length-1)!;
  resolveShipContact(shot,contact,a,def,()=>{});
  expect(shot.lodged?.moduleId).toBe(owner.id);
  a.torpedoLaunchers![0].train=Math.PI/2;
  advanceProjectile(shot,[a],.01,()=>{});
  const pose=equipmentPose(a,def,owner)!;
  expect(shot.position).toEqual(localToWorld(localToWorld(shot.lodged!.position,pose),a.motion));
});
