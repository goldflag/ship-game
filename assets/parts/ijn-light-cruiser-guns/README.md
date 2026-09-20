# Japanese light-cruiser main guns

Original reusable mountings for the IJN light cruisers, authored against approved GameModels3D visuals.
No reference geometry is loaded, copied or shipped: every recipe here draws its own mesh, and each part
maps to exactly one GameModels3D gun visual. Model fidelity does not certify historical accuracy.

Reference evidence: <https://gamemodels3d.com/en/games/worldofwarships/vehicles/pjsc013> (Kuma),
<https://gamemodels3d.com/en/games/worldofwarships/vehicles/pjsc205> (Agano).

## `type3-140-3year-single` — 14 cm/50 3rd Year Type single

- Recipe `type3_140_single.py`. Source vehicle Kuma (pjsc013), visual
  `common/visual/japan/gun/main/jgm035_140mm50_type_3year/jgm035_140mm50_type_3year`.
- The same visual is fitted on Kuma (7 mounts), Nagara-era sisters, Tenryū (pjsc015, 4), Kitakami
  (pjsc014, 4) and Iwaki (pjsc026, 5), so one part covers all of them.
- An open-backed splinter shield, not a turret. The catalog `gunhouseMesh` is therefore a thin closed
  **slab of the shield plating itself** — an outer skin, an inner skin and the rim bands that close the
  bottom edge and the rear opening — so the mount keeps its open back and its plating is real armor.
  Each skin carries half the published plate thickness, so a path through the shield collects the whole
  figure: about 20 mm on the face, 12 mm on the flanks, 10 mm on the roof.
- The recipe adds the deck ring, revolving pedestal, trunnion standards, ready-use racks, the octagonal
  slide with its sliding gun and breech, the three flank step rungs, the roof sight hood, the two hinged
  sight scuttles and the canvas gun-port bag (`gun_bloomers.create_bloomer`).
- Approximations: the shield's lower rear corner is square here and cut away on the reference; the
  reference's 9 cm below-deck base lip is not drawn (the sole stays flat at Z = 0); the gun jacket is a
  constant sleeve over the cuff's recoil stroke where the reference tapers continuously; interior fittings
  are interpretations of the reference component bounds.
- Elevation +25° is the Kuma/Nagara figure; Tenryū's mounts were +20° and Sendai/Yūbari singles +30°.
  One entry covers all four reference ships.
- Yūbari's `jgm032_140mm50_type_3` is **not** this mount: it is a two-gun mounting (two muzzle sockets at
  y ±0.354, 9.43 × 3.65 × 2.56 m, pivot 1.461, muzzle 5.457) with a lower, wider, squarer open-backed
  shield. It needs its own part and is not built here.

## `type41-152-agano-twin` and `type41-152-agano-twin-rf` — 15.2 cm/50 41st Year Type twin

- Recipes `type41_152_twin.py` and `type41_152_twin_rf.py`. Source vehicle Agano (pjsc205), visuals
  `.../jgm167_152mm50_type_41/jgm167_152mm50_type_41` and
  `.../jgm168_152mm50_type_41_rf/jgm168_152mm50_type_41_rf`.
- Fitted on Agano (2 plain + 1 rangefinder), Yahagi (pjsc505, 2 + 1) and Gokase (pjsc206, 2 + 2).
- **Two parts, not one.** Below the roof the two visuals are the same gunhouse, but jgm168 carries a
  transverse rangefinder house over the after roof: 6.70 m across against 4.99 m, and 3.84 m tall against
  2.86 m. That is a plainly different silhouette, so the rangefinder mounting is registered separately.
  The `-rf` recipe duplicates the plain one rather than importing it, so each part stands alone.
- A closed gunhouse: rounded rear, tumblehome flanks, a raked lower face, a knuckle at z 1.32 and a long
  glacis to the roof. The catalog `gunhouseMesh` is that enclosure and is drawn as the visible housing.
- Both recipes add the racer plate, roller drum and twelve rim gussets, the two gun-port fairings with
  their stepped sliding jackets, the roof sight drums and periscopes, three grab rails and a seven-rung
  boarding ladder per flank, the rear quarter bracket, the forward sighting bar, the ready-use blast tube
  and the rear access door. The `-rf` recipe adds the rangefinder house, its arms, tube ends, optical
  windows and the ladder up the back plate.
- Approximations: the whole elevating mass is kept above the gunhouse sill so it never reaches the roller
  drum, which makes the drawn breech and elevating arc shorter than a real 15.2 cm breech that swings into
  the handling-room well at +55° — all of it is inside a closed gunhouse and never visible. The gun-port
  fairing is a fixed ring rather than a rocking port shield. The rear door stands proud where the
  reference recesses it. The rangefinder house is recipe geometry, not armor; `rangefinderWidth` and
  `rangefinderForward` are set so the simulation's own rangefinder body covers the arms.

## Data basis

Mount and gun figures are commonly published values (mount weight, elevation and traverse limits and
rates, muzzle velocity, projectile mass, rate of fire, rounds per gun) taken from the general naval
ordnance literature; `penetrationMm`, `damage`, `ammoPerBarrel` and `armorMm` are **provisional game
calibration scaled from `type41-152-kongo-casemate`** (the same 15.2 cm gun) with the 14 cm figures scaled
down by caliber and projectile mass from it. Plate families use commonly published figures with estimated
facet boundaries: about 20 mm on the 14 cm shield face and 10–12 mm elsewhere, and about 25 mm on the
Agano gunhouse face with 20 mm flanks, rear and roof and a 12 mm floor. Ballistics, AP and HE blocks come
from the catalog's own documented formulas. None of this is historical certification.
