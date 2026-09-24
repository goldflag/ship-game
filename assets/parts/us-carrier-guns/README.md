# US carrier guns (USS Enterprise CV-6)

Original Blender recipes (`geometry.py`) for Enterprise's open gun mounts. Each variant was measured against a single
GameModels3D visual, using its silhouettes, sections and joint nodes, and was used for comparison only. No reference mesh is
loaded, traced or shipped.

| Part | Builder | Reference visual | Source vehicle |
| --- | --- | --- | --- |
| `us-5in38-mk24-single` | `us-carrier-mk24` (`create_five_inch`) | `AGS022_5in38_Mk24` | Enterprise `pasa518` (`HP_AGS_1..8`) |
| `us-11in75-quad` | `us-carrier-11in-quad` (`create_quad`) | `AGA013_1in_Mk2_Mod2` | Pensacola `pasc106`: the one approved supplement for Enterprise |
| `us-20mm-oerlikon-mk4` | `us-carrier-oerlikon-mk4` (`create_oerlikon`) | `AGA003_20mm_Oerlikon_MK4` | Enterprise `pasa518` |

The mount origin is the reference hardpoint, so the ship supplies the deck, sponson or tub up to that plane. A fixed
`<id>.base` carries the parts that do not train: the Mk 24 stand, the quad's training ring and the Oerlikon column.

## Datums

| Datum | Mk 24 | 1.1-inch quad | 20 mm Mk 4 |
| --- | --- | --- | --- |
| `pivotHeight` | 1.866 (`Rotate_X`) | 1.45 | 1.153 |
| `trunnionForward` | -0.042 (`Rotate_X`) | -0.188 | -0.30 |
| `muzzleForward` | 4.567 (`Roll_Back1`) | 1.75 | 1.403 |
| `barrelSpacing` | n/a | 0.242 (`gunFire1..4`) | n/a |
| `barbetteRadius` | 0.74 (stand foot) | 0.61 (training ring) | 0.39 (column foot) |

The two AA visuals have no joint nodes because they are baked at an elevation: 31° for the quad and 29.9° for the Oerlikon.
Their pivots were taken from the trunnion bosses on the bore axis, and each muzzle reach is the distance from that pivot to
the `gunFire` socket.

## Weapon values

The Mk 24's weapon values are copied unchanged from `us-5in38-mk21-single`, and the Oerlikon's from `oerlikon-20mm-single`.
The quad keeps its previous values. These are provisional game calibration; only datums and housing sizes follow the reference.

## Approximations

- **Mk 24:** the slide stops 1.5 m aft of the trunnion; the reference reaches 2.1 m. That longer rear would pass through the
  stand and deck at high elevation. The reference's sight bar, telescopes and crew stations are simplified, and the
  training gear teeth, cables, bolts and small fittings are omitted.
- **Quad:** the Mk 2's common slide is split into four sections that meet at 2 mm joints, one on each gun's elevation
  joint and seated in that gun's receiver, because the catalog gives every barrel its own joint. The cooling hoses are split into a fixed part and a stub that moves with each barrel, where the reference has one
  flexible hose. The seat shells are boxes rather than bells, and the feed-clip detail is reduced.
- **20 mm:** the reference's low strip joining the two shield wings is left open so the recoil casing clears at -10°. The
  canvas case bag is omitted because it would swing into the column above about 45°.
