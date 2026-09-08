/** Original equipment placements sampled from this repository's original recipes.
 * Stable IDs and support coverage are gameplay authoring, not historical claims. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { shipPresets } from '../../src/ships/presets';
import { compileShip, type Module, type ShipBlueprint, type Vec3 } from '../../src/ships/blueprint';
import { mergeEquipmentDamage } from './author-local-damage';
const args = process.argv.slice(2), roster = Object.keys(shipPresets);
if (!args.length || args.some(id => id !== 'all' && !roster.includes(id)) || args.includes('all') && args.length > 1) throw new Error('Usage: bun assets/ships/author-equipment.ts <ship-id> [...] | all');
const ids = args[0] === 'all' ? roster : [...new Set(args)];
const catalog = JSON.parse(await readFile(new URL('../parts/guns.json', import.meta.url), 'utf8'));
for (const id of ids) {
  const path = new URL(`./${id}/blueprint.json`, import.meta.url);
  let b = JSON.parse(await readFile(path, 'utf8')) as ShipBlueprint;
  const previousMountIds = new Set(b.mounts.map(m => m.id));
  const own = (m: Module) => { b.modules = b.modules.filter(old => old.id !== m.id); b.modules.push(m); };
  if (id === 'king-george-v') {
    const deck = b.hull.depth - b.hull.draft;
    const evidence = JSON.parse(await readFile(new URL('./king-george-v/equipment-evidence.json',import.meta.url),'utf8')) as {version:number;registrationPolicy:string;stations:{id:string;status:string;position:Vec3}[]};
    if (evidence.version !== 1 || !['verified-only','allow-approximate'].includes(evidence.registrationPolicy)) throw new Error('Invalid KGV equipment evidence register');
    b.mounts = b.mounts.filter(m=>!evidence.stations.some(s=>s.id===m.id));
    for (const [i,station] of evidence.stations.entries()) {
      if (station.status !== 'verified' && evidence.registrationPolicy !== 'allow-approximate') continue;
      b.mounts.push({ id:station.id,name:`Pom-pom ${i+1}`,partId:'qf-2pdr-mkvi-octuple',battery:'secondary',position:station.position,bearingDeg:station.position[0]<0?-90:90,rangefinder:false });
    }
    b.modules = b.modules.filter(m => m.id !== 'support-director');
    const directors: [string, number, number, number, boolean][] = [
      ['dct-forward',22.3,0,16.35,true],['dct-after',-45,0,8.1,true],
      ['hacs-p-forward',15.1,2.35,21.2,false],['hacs-s-forward',15.1,-2.35,21.2,false],
      ['hacs-p-after',-40,3.2,9.2,false],['hacs-s-after',-40,-3.2,9.2,false],
    ];
    for (const [name,x,y,z,main] of directors) own({ id: `equipment-${name}`, name: main ? `${name === 'dct-forward' ? 'Forward' : 'Aft'} main director` : name.replaceAll('-', ' '), kind: 'fire-control', placement: 'fixed', center: [-y,deck+z+1.6,-x], size: main ? [3.7,3.2,3.6] : [2.2,2.7,2.7], hp:65, protectionMm:10, immersionToleranceM: .3,
      servesMountIds: b.mounts.filter(m => main ? m.battery === 'main' : m.battery === 'secondary' && !m.id.startsWith('pom-pom') && Math.sign(m.position[0]) === Math.sign(-y)).map(m => m.id) });
    // Pom-poms retain local control; do not assign HACS to the separate close-AA system.
  }
  // Fixed station boxes cover the central director housings, excluding long
  // optics/aerials that sweep decoratively. Coverage is an authored gameplay
  // approximation, not an electrical circuit or historical assignment claim.
  const station = (name: string, xyz: Vec3, size: Vec3, serves: (m: ShipBlueprint['mounts'][number]) => boolean) => {
    b.modules = b.modules.filter(m => m.id !== 'support-director');
    own({ id: `equipment-${name}`, name: name.replaceAll('-', ' '), kind: 'fire-control', placement: 'fixed', center: [-xyz[1],xyz[2],-xyz[0]], size, hp:65, protectionMm:10, immersionToleranceM:.3, servesMountIds:b.mounts.filter(serves).map(m=>m.id) });
  };
  const caliber = (m: ShipBlueprint['mounts'][number]) => catalog.parts.find((p: {id:string}) => p.id === m.partId).caliberM as number;
  if (id === 'bismarck') {
    for (const [name,x,z] of [['fore-main-director',13.4,32],['conning-director',27.6,20.6],['aft-main-director',-37.8,17.5]] as const)
      station(name,[x,0,z+.18],[3.7,1.6,3.3],m=>caliber(m)>=.15);
    for (const side of [-1,1]) for (const [name,x,y,z] of [['forward',15.8,6.5,17.6],['funnel',.2,5.35,21.1]] as const)
      station(`${name}-${side<0?'starboard':'port'}-aa-director`,[x,side*y,z+.4],[3.6,2.9,4.5],m=>caliber(m)>.1&&caliber(m)<.15&&Math.sign(m.position[0])===-side);
  }
  if (id === 'baltimore') {
    for (const [name,x,z,main] of [['forward-main-director',21.4,17.85,true],['after-main-director',-36,10.94,true],['forward-dp-director',14.1,22.89,false],['after-dp-director',-27.7,20.14,false]] as const)
      station(name,[x,0,z+(main?1.7:1.875)],[2.9,main?2:2.35,2.95],m=>main?m.battery==='main':caliber(m)>.1&&m.battery==='secondary');
  }
  if (id === 'fletcher') station('mk37-director',[19.975,0,14.37],[2.9,2.1,3.35],m=>caliber(m)>.1);
  if (id === 'enterprise-cv6') {
    const ft=.3048, fp=b.hull.length/2-18.75*ft;
    for (const [name,frame,level] of [['forward-mk33-director',71.5,111.75],['aft-mk33-director',110.7,109.5]] as const)
      station(name,[fp-frame*4*ft,-36.25*ft,level*ft-b.hull.draft+1.55],[2.5,1.4,2.2],m=>caliber(m)>.1);
  }
  if (id === 'yamato') {
    station('main-director',[-3.2,0,37.35],[3.6,2.2,3.6],m=>m.battery==='main'||caliber(m)>.15);
    station('aft-director',[-38.6,0,22.8],[4.1,3.9,4.1],m=>m.battery==='main'||caliber(m)>.15);
    for (const side of [-1,1]) for (const [i,x,z] of [[1,0,21],[2,-6,25],[3,-35,16]])
      station(`ha-director-${side<0?'starboard':'port'}-${i}`,[x,side*5.9,z+1.75],[2.4,1.5,2.8],m=>caliber(m)>.1&&caliber(m)<.15&&Math.sign(m.position[0])===-side);
  }
  for (const launcher of b.torpedoLaunchers ?? []) {
    const moduleId = `equipment-${launcher.id}`;
    own({ id: moduleId, name: launcher.name, kind:'launcher', placement:'fixed', torpedoLauncherId: launcher.id, center:[launcher.position[0],launcher.position[1]+.95,launcher.position[2]], size:[3.72,1.6,7.1], hp:100, protectionMm:8, immersionToleranceM:.3 });
    b.torpedoTubes!.filter(t => t.launcherId === launcher.id).forEach(t => t.launcherModuleId = moduleId);
  }
  for (const tube of b.torpedoTubes?.filter(t => !t.launcherId) ?? []) {
    const magazine = b.modules.find(m => m.id === tube.magazineId)!, room = b.compartments.find(r => r.id === magazine.compartmentId)!;
    const moduleId = `equipment-${tube.id}`, size: Vec3 = [.55,.55,Math.min(6,room.size[2]*.8)];
    const center = tube.position.map((v,axis) => Math.max(room.center[axis]-room.size[axis]/2+size[axis]/2,Math.min(room.center[axis]+room.size[axis]/2-size[axis]/2,v))) as Vec3;
    own({ id:moduleId,name:tube.name,kind:'launcher',compartmentId:room.id,center,size,hp:80,protectionMm:8,immersionToleranceM:.2 });
    tube.launcherModuleId = moduleId;
  }
  for (const l of id === 'fletcher' ? b.depthChargeLaunchers ?? [] : []) {
    const rack = l.id.includes('rack'), moduleId = `equipment-${l.id}`;
    own({ id:moduleId,name:l.name,kind:'launcher',placement:'fixed',center:[l.position[0],l.position[1]+.15,l.position[2]-(rack?2.45:0)],size:rack?[1.1,.8,5.65]:[.8,.9,1.3],hp:rack?70:45,protectionMm:3,immersionToleranceM:.25 });
    l.launcherModuleId = moduleId;
  }
  if (id === 'flower-corvette') {
    const ids = new Set((b.depthChargeLaunchers ?? []).map(l => `equipment-${l.id}`));
    b.modules = b.modules.filter(m => !ids.has(m.id));
    b.depthChargeLaunchers?.forEach(l => { delete l.launcherModuleId; });
  }
  mergeEquipmentDamage(b, previousMountIds);
  for (const m of b.modules.filter(m => m.kind === 'fire-control')) m.servesMountIds ??= b.mounts.map(m => m.id);
  compileShip(b,catalog);
  await writeFile(path,JSON.stringify(b,null,2)+'\n');
  const report = new URL(`../../.build/ships/${id}/equipment-inventory.json`,import.meta.url);
  await mkdir(new URL('.',report),{recursive:true});
  await writeFile(report,JSON.stringify({version:1,basis:'Original blueprint/recipe equipment inventory. Placement, HP, coverage and protection are game approximations; historical uncertainties remain in the ship README.',functional:{guns:b.mounts.map(m=>({id:m.id,partId:m.partId})),equipment:b.modules.map(m=>({id:m.id,kind:m.kind,placement:m.placement??'room',servesMountIds:m.servesMountIds,torpedoLauncherId:m.torpedoLauncherId}))},unresolved:id==='king-george-v'?['KGV-005/006: existing turret and bridge proportion uncertainties remain.','KGV-007: four octuple pom-poms and UP launchers remain decorative; individual station coordinates and mechanism review are unresolved. See equipment-evidence.json.','Octuple mechanism dimensions and close-AA director coverage remain approximations.']:['Other visual fittings require a dated per-fitting evidence audit before registration.',b.modules.some(m=>m.id==='support-director')?'Existing support-director location remains an internal proxy until a sourced exposed station is authored.':'Fixed director stations follow existing original recipe housings; exact historical dimensions/coverage remain estimates.']},null,2)+'\n');
  console.log(`${id}: equipment authored`);
}
