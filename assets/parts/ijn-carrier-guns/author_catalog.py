"""Add the original IJN carrier mounting variants without rewriting other parts."""
import json
from pathlib import Path

path=Path(__file__).resolve().parents[1]/'guns.json'
catalog=json.loads(path.read_text())
parts=[]
for shield in [False,True]:
    id='type89-127-a1-mod2-twin' if shield else 'type89-127-a1-twin'
    parts.append(dict(id=id,name='12.7 cm/40 Type 89 '+('A1 Mod 2 twin' if shield else 'A1 twin'),kind='gun',massKg=24500 if shield else 20300,
      barbetteRadius=2.3,gunhouseSize=[4.7,4.1,3.35],pivotHeight=2.49,trunnionForward=.55,muzzleForward=5.13,
      barrelSpacing=1.3,caliberM=.127,traverseDeg=70,traverseRateDeg=7,elevationMinDeg=-7,elevationMaxDeg=85,elevationRateDeg=12,
      reloadSeconds=5,muzzleSpeed=720,projectileMassKg=23.45,penetrationMm=55,damage=15,recoilM=.45,ammoPerBarrel=300,armorMm=5,barrelCount=2,
      mountingStyle='open-pedestal',barrelBaseRadius=.145,
      he=dict(explosiveKg=1.778,fragmentPenetrationMm=21,damage=24,stockFraction=1,basis='Type 0 HE nominal projectile and filling; blast damage is gameplay calibration.'),
      ballistics=dict(dragPerSecond=.06072,dispersionRad=.0012,muzzleSpeedSigmaFraction=.003,penetrationReferenceSpeedMps=416.9,
        basis='S05: Type 89 A1 720 m/s, 7 deg/s train, 12 deg/s elevation, 0.45 m recoil. Published 70-degree amidships half-arc; per-station mechanical stops remain unresolved. Effective ballistics and stocks are game estimates.')))
for shield in [False,True]:
    id='type96-25-triple-shielded' if shield else 'type96-25-triple'
    parts.append(dict(id=id,name='25 mm Type 96 triple'+(' smoke shield' if shield else ''),kind='gun',massKg=2800 if shield else 1800,
      barbetteRadius=1.1,gunhouseSize=[2.4,2.6,1.9],pivotHeight=1.35,trunnionForward=.12,muzzleForward=1.58,
      barrelSpacing=.43,caliberM=.025,traverseDeg=90,traverseRateDeg=18,elevationMinDeg=-10,elevationMaxDeg=85,elevationRateDeg=12,
      reloadSeconds=.55,muzzleSpeed=900,projectileMassKg=.25,penetrationMm=18,damage=2.5,recoilM=.075,ammoPerBarrel=1500,armorMm=3,barrelCount=3,
      mountingStyle='open-quad',barrelBaseRadius=.041,
      he=dict(explosiveKg=.015,fragmentPenetrationMm=5,damage=3,stockFraction=1,basis='Type 96 HE filling; average firing cadence includes frequent 15-round magazine changes. Blast is provisional.'),
      ballistics=dict(dragPerSecond=.27,dispersionRad=.002,muzzleSpeedSigmaFraction=.005,penetrationReferenceSpeedMps=530,
        basis='S06 nominal 900 m/s. Effective sustained cadence, dispersion, recoil and mount sectors are gameplay estimates; this is not a projectile-by-projectile magazine simulation.')))
ids={p['id'] for p in parts}
catalog['parts']=[p for p in catalog['parts'] if p['id'] not in ids]+parts
path.write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n')
print('Authored',', '.join(p['id'] for p in parts))
