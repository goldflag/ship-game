# Battle landforms

These are original fictional landscapes inspired by ocean regions, not reconstructions of surveyed islands.

The durable island placements, dimensions and seeds live in `environments.v1.json`. `src/maps/terrain.ts` is the original deterministic generation recipe. Each seed builds a 257 × 257 normalized heightfield once and caches it. The recipe combines asymmetric, overlapping mountain massifs (or a recessed volcanic cone), domain-warped multiscale ridges, and 36,000 hydraulic erosion droplets with sediment transport. Each droplet follows the downhill gradient for at most 65 steps. The resulting drainage channels join naturally downhill instead of decorating a smooth dome with unrelated bumps.

A multiscale coastline remains bounded inside 1.2 times each island's radii. It cuts irregular coves and headlands while preserving the deployment corridor. A smooth exponential coastal taper alternates low rubble beaches with steeper headlands and blends back into unmodified inland relief between 60 and 500 m inland. A narrow 4 m coastal taper keeps the analytical shoreline at exactly zero after heightfield interpolation. The renderer, navigation, camera clearance and shell/torpedo queries sample the same renderer-free CPU surface. Heights scale with the island recipe; moving the deployment corridor translates the land without regenerating its geography. Physical erosion is an artistic approximation in normalized grid coordinates, not a geological simulation.

`src/game/BattleLandscape.ts` renders 512 sectors × 176 radial rings at High/Ultra, and 320 × 112 at Medium. An exact coastline ring connects to a submerged skirt. Triplanar rock color blended across two scales, world-scale variation, slope-dependent rock exposure, and snow accumulation break up the surface. Snow uses a smooth normal and favors gentler slopes; rock uses restrained fine normal relief. The ship-centered shadow map is excluded from distant terrain because its finite coverage cannot represent kilometer-scale landforms. Tropical beaches occupy low gentle coves.

Irregular forest groves follow slope, elevation and a density field. Crossed alpha-tested tree crowns use independently sampled height scales of 18–30 m and width scales of 16–36 m, with depth at 70–100% of width, varied rotation and per-tree brightness. Muted foliage and darker ground beneath groves join the canopy to the terrain. High/Ultra forest placement spacing is 13 m and Medium is 20 m. Tree placements compensate for the transparent image border at the base of the trunk and sink slightly into the surface to accommodate finite mesh sampling. Crowns use normals derived from the supporting terrain slope for diffuse lighting so rotating the flat impostor cards cannot change the grove brightness. Volcanic ground and trees share restrained diffuse fill.

Rock, ground, meadow textures and the broadleaf tree impostor reuse the retained CC0 harbor assets, credited in `public/harbor/ASSETS.md`. All mountain and coastal geometry is authored here. No external regional heightmap or other game's model is used. Battle land textures, instancing resources, meshes and materials are disposed when maps change.

## Review

- `review/before-landforms/`: the previous three coastal map renders.
- `review/*-detail.png`: coast-level close views of the replacement terrain.
- `review/*-survey-*.png`: clear-sky survey views of all nine landforms (cloud volume hidden, map lighting and water retained).
- `review/landforms.html`: interactive before/after comparisons at the same camera and sea state.
- `capture.py`: refresh standard map screenshots and picker thumbnails.
- `capture-landforms.py`: refresh close and survey views from `/scripts/diagnostics/ocean-maps.html`.

The in-game review freezes simulation and wave time, advances real animation frames (Three caches scene passes per frame), and waits for GPU completion before readback. Standard and close views retain map clouds. Aerial terrain surveys hide the cloud volume: high Arctic survey cameras intersect the low cloud layer, whose compositor can obscure land with hard edges. This cloud-compositor limitation is separate from the terrain and is not concealed in gameplay captures. The terrain remains an approximation at the finite rendered triangle resolution; no caves, overhangs, tides, grounding damage or terrain deformation are introduced.
