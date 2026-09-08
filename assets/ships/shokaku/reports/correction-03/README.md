# Shōkaku — superstructure deck correction

The preceding window/shape review missed five overlapping horizontal deck skins. The user's report was reproduced from high and overhead cameras in the actual game, and independently in the retained Blender source and exported GLB. This record supersedes the preceding acceptance of the island walking surfaces.

Before hash: `2d43863548c9dfcee9b1822b75dee70d501d16271e334d13ce5c1accfd00c0b8`. Corrected hash: `b04a6f27641f67fb5177bea72d65023751e642a1284735d69f9e090c837ba898`.

## Cause and durable fix

Four enclosed rooms extended through their overlying 0.16 m deck plates to the walking surface. Where the next room stepped back, both upward faces competed for the same depth. The lower signal gallery also overlapped the adjoining wooden flight deck.

The original [arrangement recipe](../../authoring/generate_blueprint.py) now seats each room roof against the underside of its plate. The gallery footprint is clipped to the existing flight-deck cutout at Blender y = -10.7 m, sharing only an edge. Its port knees and rails meet that new edge. The [build recipe](../../build.py) retains scuttle elevations using the unchanged floor-to-floor datum.

Only five blueprint structures changed. The [input comparison](../geometry-b04a6f27/authoring-delta.json) confirms unchanged hull, mounts, modules, aircraft, damage and stability inputs. All four walking elevations remain 14.75, 17.06, 19.46 and 21.64 m. This is a construction fix within the prior reconstruction; historical source uncertainties remain in the [discrepancy register](../discrepancies.md).

## Reproduction and regression

[Source before](before/decks-source.json) and [GLB before](before/decks-glb.json) independently identify the same five pairs:

| Competing surfaces | Elevation (m) | Shared area before (m²) | After |
| --- | ---: | ---: | --- |
| Signal gallery / flight deck | 14.75 | 6.2431 | 0 |
| Signal gallery / lower bridge roof | 14.75 | 64.8074 | 0 |
| Navigation wings / chartroom roof | 17.06 | 49.7030 | 0 |
| Compass platform / navigation house roof | 19.46 | 44.8809 | 0 |
| Open upper platform / conning-room roof | 21.64 | 31.8613 | 0 |

The [source after](../geometry-b04a6f27/decks-source.json) and [GLB after](../geometry-b04a6f27/decks-glb.json) contain zero positive-area overlaps and all four required deck surfaces. The regression clips actual horizontal triangles, with 1 mm coplanarity tolerance and a 0.00001 m² minimum overlap. Shared edges and opposite-facing hidden ceiling contacts are allowed. Hidden hangar ceilings, markings and fittings at other elevations are outside this walking-surface regression. See [reproduction commands](../../authoring/README.md).

## Matched game views

| Camera | Before | Corrected |
| --- | --- | --- |
| Forward high | [Before](before/decks-forward-high.png) | [After](../geometry-b04a6f27/decks-forward-high.png) |
| Aft high | [Before](before/decks-aft-high.png) | [After](../geometry-b04a6f27/decks-aft-high.png) |
| Overhead | [Before](before/decks-top.png) | [After](../geometry-b04a6f27/decks-top.png) |

[Camera coordinates](../geometry-b04a6f27/decks-cameras.json) are identical to the [baseline](before/cameras.json), with all ship geometry present and normal game lighting. The broad striped and triangular material conflicts have disappeared. Faint stepped patterns at cast-shadow edges remain at the game's existing shadow resolution; temporarily suppressing shadow intensity isolates these from the deck geometry. The retained [diagnostic](shadow-diagnostic.json) and [shadow-free overhead probe](decks-top-shadow-probe.png) disclose that temporary override. Acceptance images use normal shadows. No production renderer or depth-bias change was made.

The exact rebuilt model also passes the attachment, window, source articulation, mechanism, neighbor and exported-game checks linked in [acceptance](../acceptance.md). Local Blender 5.2.0 LTS built and reviewed the source; no Blender MCP tool was exposed. All 892 tests and the production build pass; command evidence is in [validation](../validation.json).
