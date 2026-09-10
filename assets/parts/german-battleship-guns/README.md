# German battleship gun mounts

`sk-c34-380-twin` is the original reusable Bismarck 38 cm twin mount. The catalog
owns the armor facets and weapon data; `sk_c34.py` owns the optical housings,
service fittings and cloth seals. The ship supplies the fixed barbette's deck
height. Existing mount IDs, yaw/elevation/recoil nodes and muzzle sockets remain
unchanged. The compiled mount's `rangefinder` flag selects the projecting optical
wings; Anton retains covered side blisters.

Geometry follows the approved [GameModels3D Bismarck '41 A artillery](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pgsb708)
visual reference. Geometry is independently authored; this is not historical
certification. Fine service details and rigidly articulated cloth remain
approximations. The installed elevation range follows the approved A artillery
configuration (−1° to +30°), not an independently established mechanical stop. Library review stays unreviewed until installation review passes.

```sh
bun run part:build sk-c34-380-twin
bun run part:check sk-c34-380-twin
bun run model:viewer
```

Standalone preview uses the default covered-blister installation; choose Bruno,
Caesar or Dora's installed preview to inspect rangefinder wings. Temporary
comparison renders and articulation captures belong in `.build/`.

`flak-37-bismarck-1941` now uses the original reusable `sk_c30.py` twin. Its
rearward trunnions, open bearing fork, sliding receivers, recoil cylinders,
controls and footboards replace the ship recipe's generic medium AA mount.
At the approved model's displayed 30-degree pose, the muzzle locations imply
an approximately −0.45 m fore/aft pivot, 1.6275 m axis height and 0.40 m barrel
spacing with a 2.22 m pivot-to-muzzle length. These are visual reconstruction
measurements, not a recovered mechanical drawing. The builder reads those
dimensions from the catalog and preserves the existing joint/socket IDs.

The low mounting sole extends 0.10 m below the installation root. Ships own
their deck or sponson support; the component does not build a column down to
the weather deck. The original reference's AA `horizSector`, `deadZone` and
`pitchDeadZones` fields are empty, so the retained catalog travel remains an
authored game approximation. Isolated receiver/cradle clearance does not certify
independent neighboring mounts or each ship's surrounding galleries.

```sh
bun run part:build flak-37-bismarck-1941
bun run part:check flak-37-bismarck-1941
bun run part:inputs flak-37-bismarck-1941
```
