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
approximations. Library review stays unreviewed until installation review passes.

```sh
bun run part:build sk-c34-380-twin
bun run part:check sk-c34-380-twin
bun run model:viewer
```

Standalone preview uses the default covered-blister installation; choose Bruno,
Caesar or Dora's installed preview to inspect rangefinder wings. Temporary
comparison renders and articulation captures belong in `.build/`.
