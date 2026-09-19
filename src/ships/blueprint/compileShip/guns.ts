/** Gun catalog parts and the mounts that fit them. */
import { fail, record, text, numeric, list, literal, id, vector, unique, validateTriangle, type Rec } from '../validators';

export function validateGunParts(catalog: Rec): Rec[] {
  const parts = list(catalog.parts, 'parts').map((p, i) => record(p, `parts[${i}]`));
  unique(parts, 'parts');
  const requiredNumbers = ['massKg', 'barbetteRadius', 'pivotHeight', 'muzzleForward', 'barrelSpacing', 'caliberM', 'traverseDeg', 'traverseRateDeg', 'elevationRateDeg', 'reloadSeconds', 'muzzleSpeed', 'projectileMassKg', 'penetrationMm', 'damage', 'ammoPerBarrel', 'armorMm'];
  parts.forEach(p => {
    literal(p.kind, ['gun'], `${p.id}.kind`); text(p.name, `${p.id}.name`);
    requiredNumbers.forEach(k => numeric(p[k], `${p.id}.${k}`, .00001));
    numeric(p.recoilM, `${p.id}.recoilM`, 0);
    numeric(p.trunnionForward, `${p.id}.trunnionForward`, -100, 100);
    vector(p.gunhouseSize, `${p.id}.gunhouseSize`, .001);
    numeric(p.traverseDeg, `${p.id}.traverseDeg`, 0, 180);
    numeric(p.elevationMinDeg, `${p.id}.elevationMinDeg`, -15, 0);
    numeric(p.elevationMaxDeg, `${p.id}.elevationMaxDeg`, 0, 90);
    if ((p.muzzleForward as number) <= (p.trunnionForward as number)) fail(String(p.id), 'muzzle must be forward of the trunnion');
    if (!Number.isInteger(p.ammoPerBarrel)) fail(String(p.id), 'ammunition must be an integer');
    {
      const flight = record(p.ballistics, `${p.id}.ballistics`);
      numeric(flight.dragPerSecond, 'ballistics.dragPerSecond', 0, .5);
      numeric(flight.dispersionRad, 'ballistics.dispersionRad', 0, .02);
      if (flight.muzzleSpeedSigmaFraction !== undefined) numeric(flight.muzzleSpeedSigmaFraction, 'ballistics.muzzleSpeedSigmaFraction', 0, .05);
      if (flight.penetrationReferenceSpeedMps !== undefined) numeric(flight.penetrationReferenceSpeedMps, 'ballistics.penetrationReferenceSpeedMps', 1, 10000);
      text(flight.basis, 'ballistics.basis');
    }
    if (p.ap !== undefined) {
      const ap = record(p.ap, `${p.id}.ap`);
      numeric(ap.armingResistanceMm, 'ap.armingResistanceMm', .001, 2000);
      numeric(ap.fuzeDelaySeconds, 'ap.fuzeDelaySeconds', .001, .2);
      numeric(ap.explosiveKg, 'ap.explosiveKg', .00001, 200);
      numeric(ap.fragmentPenetrationMm, 'ap.fragmentPenetrationMm', .001, 200);
      text(ap.basis, 'ap.basis');
      if ((ap.explosiveKg as number) >= (p.projectileMassKg as number)) fail(`${p.id}.ap`, 'explosive filling must be less than projectile mass');
    }
    if (p.he !== undefined) {
      const he = record(p.he, `${p.id}.he`);
      numeric(he.explosiveKg, 'he.explosiveKg', .00001, 200);
      numeric(he.fragmentPenetrationMm, 'he.fragmentPenetrationMm', .001, 200);
      numeric(he.damage, 'he.damage', .00001, 10000);
      numeric(he.stockFraction, 'he.stockFraction', 0, 1);
      text(he.basis, 'he.basis');
      if ((he.explosiveKg as number) >= (p.projectileMassKg as number)) fail(`${p.id}.he`, 'explosive filling must be less than projectile mass');
    }
    literal(p.barrelCount, [1, 2, 3, 4, 8], `${p.id}.barrelCount`);
    if (p.mountingStyle !== undefined) literal(p.mountingStyle, ['enclosed', 'open-pedestal', 'open-quad', 'oerlikon', 'pom-pom'], `${p.id}.mountingStyle`);
    if (p.barrelCount === 8 && p.mountingStyle !== 'pom-pom') fail(String(p.id), 'eight barrels require the pom-pom common-cradle recipe');
    if (p.barrelCount === 8 || p.barrelVerticalSpacing !== undefined) numeric(p.barrelVerticalSpacing, `${p.id}.barrelVerticalSpacing`, .001, 10);
    for (const k of ['barrelBaseRadius', 'rangefinderWidth', 'gunhouseBaseHeight', 'rollerRadius']) if (p[k] !== undefined) numeric(p[k], `${p.id}.${k}`, .001, 100);
    if(p.rangefinderForward!==undefined)numeric(p.rangefinderForward,`${p.id}.rangefinderForward`,-100,100);
    if (p.gunhouseShape !== undefined) {
      const shape = record(p.gunhouseShape, `${p.id}.gunhouseShape`);
      const footprint = list(shape.footprint, 'gunhouseShape.footprint', 32), roof = list(shape.roof, 'gunhouseShape.roof', 32);
      if (footprint.length < 3 || roof.length !== footprint.length) fail(String(p.id), 'gunhouse footprint and roof require matching polygons');
      footprint.forEach(v => { const point = list(v, 'footprint point', 2); if (point.length !== 2) fail(String(p.id), 'expected a 2D footprint point'); point.forEach(n => numeric(n, 'footprint coordinate', -100, 100)); });
      roof.forEach(v => vector(v, 'roof point'));
    }
    if (p.gunhouseMesh !== undefined) {
      if (p.gunhouseShape !== undefined) fail(String(p.id),'choose one gunhouse geometry format');
      const mesh=record(p.gunhouseMesh,`${p.id}.gunhouseMesh`);literal(mesh.version,[1],'gunhouseMesh.version');
      const vertices=list(mesh.vertices,'gunhouseMesh.vertices',128).map(v=>vector(v,'gunhouse vertex'));
      const faces=list(mesh.faces,'gunhouseMesh.faces',128).map(f=>record(f,'gunhouse face'));unique(faces,'gunhouse faces');
      faces.forEach(f=>{validateTriangle(f.indices,vertices,'gunhouse face');numeric(f.thicknessMm,'gunhouse thickness',.1,2000);literal(f.material,['KC','Wh','steel'],'gunhouse material');literal(f.finish,['naval','roof'],'gunhouse finish');});
      const edges=new Map<string,{count:number;winding:number}>();
      faces.forEach(f=>{const ids=f.indices as number[];ids.forEach((a,i)=>{const c=ids[(i+1)%3],key=[a,c].sort((a,b)=>a-b).join(':');const edge=edges.get(key)??{count:0,winding:0};edge.count++;edge.winding+=a<c?1:-1;edges.set(key,edge);});});
      // Explicit open boundary loops are topology metadata, never armor plates.
      const apertures=list(mesh.apertures??[],'gunhouseMesh.apertures',16).map(a=>record(a,'gunhouse aperture'));
      unique(apertures,'gunhouse apertures');
      apertures.forEach(aperture=>{
        id(aperture.id,'gunhouse aperture id');
        const loop=list(aperture.indices,'gunhouse aperture indices',128).map(n=>numeric(n,'gunhouse aperture index',0,vertices.length-1));
        if(loop.length<3 || new Set(loop).size!==loop.length || loop.some(n=>!Number.isInteger(n))) fail(String(p.id),'aperture requires at least three distinct vertex indices');
        loop.forEach((a,i)=>{
          const c=loop[(i+1)%loop.length],key=[a,c].sort((a,b)=>a-b).join(':'),edge=edges.get(key);
          if(!edge || edge.count!==1 || edge.winding!==(a<c?-1:1)) return fail(String(p.id),'aperture must close an existing consistently wound open boundary');
          edge.count++;edge.winding+=a<c?1:-1;
        });
      });
      if (!faces.length || [...edges.values()].some(e=>e.count!==2||e.winding!==0)) fail(String(p.id),'gunhouse facets must form a closed consistently wound enclosure except for declared apertures');
    }
  });
  return parts;
}

export function validateMounts(b: Rec, h: Rec, parts: Rec[]): Rec[] {
  const mounts = list(b.mounts, 'mounts', 64).map((m, i) => record(m, `mounts[${i}]`));
  unique(mounts, 'mounts');
  mounts.forEach((m, index) => {
    text(m.name, `${m.id}.name`); id(m.partId, `${m.id}.partId`);
    if (!parts.some(p => p.id === m.partId)) fail(String(m.id), `unknown part ${m.partId}`);
    literal(m.battery, ['main', 'secondary'], `${m.id}.battery`);
    literal(m.rangefinder, [true, false], `${m.id}.rangefinder`);
    if (m.initialElevationDeg !== undefined) numeric(m.initialElevationDeg, `${m.id}.initialElevationDeg`,
      Number(m.elevationMinDeg ?? parts.find(p=>p.id===m.partId)!.elevationMinDeg),
      Number(m.elevationMaxDeg ?? parts.find(p=>p.id===m.partId)!.elevationMaxDeg));
    const pos = vector(m.position, `${m.id}.position`);
    const envelope = b.mountEnvelope === undefined ? h : record(b.mountEnvelope, 'mountEnvelope');
    if (Math.abs(pos[0]) > (envelope.beam as number) / 2 || Math.abs(pos[2]) > (envelope.length as number) / 2) fail(String(m.id), 'mount lies outside the hull envelope');
    numeric(m.bearingDeg, `${m.id}.bearingDeg`, -360, 360);
    if (m.traverseDeg !== undefined) numeric(m.traverseDeg, `${m.id}.traverseDeg`, 0, parts.find(p => p.id === m.partId)!.traverseDeg as number);
    if (m.elevationMinDeg !== undefined) {
      const part = parts.find(p => p.id === m.partId)!;
      numeric(m.elevationMinDeg, `${m.id}.elevationMinDeg`, part.elevationMinDeg as number, 0);
    }
    if (m.elevationMaxDeg !== undefined) {
      const part = parts.find(p => p.id === m.partId)!;
      numeric(m.elevationMaxDeg, `${m.id}.elevationMaxDeg`, 0, part.elevationMaxDeg as number);
    }
    if (m.traverseLimitsDeg !== undefined) {
      const limit = (m.traverseDeg ?? parts.find(p => p.id === m.partId)!.traverseDeg) as number;
      const limits = list(m.traverseLimitsDeg, `${m.id}.traverseLimitsDeg`, 2);
      if (limits.length !== 2 || numeric(limits[0], `${m.id}.traverse minimum`, -limit, 0) > numeric(limits[1], `${m.id}.traverse maximum`, 0, limit)) fail(String(m.id), 'expected ordered travel limits containing neutral');
    }
    if (m.parentMountId !== undefined) {
      id(m.parentMountId, `${m.id}.parentMountId`);
      if (!mounts.slice(0, index).some(parent => parent.id === m.parentMountId)) fail(String(m.id), 'parent mount must precede its child (no missing parents or cycles)');
    }
  });
  return mounts;
}
