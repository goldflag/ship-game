# USS Iowa (BB-61)

## Approved brief

USS Iowa in an early-service appearance, using GameModels3D's earliest available
Iowa (A) configuration as an explicitly accepted approximation of her original
fit. The user approved this reference and its limits before authoring.

- Sole external visual reference: [GameModels3D Iowa, vehicle pasb018, World of
  Warships RU](https://gamemodels3d.com/en/games/worldofwarships/russia/vehicles/pasb018).
- Hull/equipment: `A_Hull` / `PAUH831_Iowa_1943`, `AB1_Artillery`, `AB_ATBA`,
  `A_AirDefense`, and the matching default directors, radars and aircraft-handling
  fittings. The source fits three triple 406 mm turrets, ten twin 127 mm mounts,
  nineteen twin 40 mm Bofors and thirty-two single 20 mm Oerlikons.
- Paint: the source's gray topsides, dark blue-gray decks, waterline band and
  muted lower-hull palette, with substantially reduced weathering for a newly
  completed appearance. Geometry and finishes are independently authored.
- Accepted limits: the configuration is labeled 1943 but reuses a hull asset
  named 1945. Exact launch-day fittings, loading/waterline and paint shades are
  unverified. Model fidelity does not establish historical accuracy. Gameplay
  values and internal layouts use provisional game conventions. The source
  supplies no AA traverse sectors; those sectors and the reconstructed hidden
  gun connections are provisional. Catapults are visual fittings, with no
  operational reconnaissance aircraft fitted.

The Mk.7 plating contours and barrel profiles, stepped bridge, director heads,
and curved funnel hoods are reconstructed from inspected close-ups of that same
configuration. Original blast-bag shapes keep the gunhouse seams fixed while
their collars follow gun elevation; concealed trunnion supports are reconstructed.
The aft main turret uses a conservative ±146° traverse limit to clear the
deckhouse at zero elevation.

Reference downloads, previews and diagnostic evidence stay in ignored `.build/`.
Follow [the ship pipeline](../../../docs/ship-pipeline.md).

Build: `bun run ship:build iowa`
Review: `bun run ship:review iowa`

Appearance follows the [shared fleet finish](../../../docs/ship-appearance.md).
The main weather deck uses a separate timber material with longitudinal grain,
staggered joints and slight caulking relief. Steel superstructure decks and gun
platforms keep the original roof finish. The approved source's blue-gray coating
is retained: timber does not imply bare tan wood. The former 0.38 m raised seam
rods are replaced by a plank texture using 0.127 m board width; repeating lengths
and exact covering margins remain interpreted.

For the user's deck-material correction, textual corroboration comes from the
[Navy's spring-1943 Iowa caption](https://www.history.navy.mil/our-collections/photography/numerical-list-of-images/nhhc-series/nh-series/80-G-K-06000/80-G-K-6116.html)
which describes Deck Blue application, and Bureau of Ships materials engineer
J. G. Kuenzel's [Wood Requirements for Shipbuilding (1950), pp. 248–249](https://doi.org/10.1093/jof/48.4.245),
which lists Iowa's wooden decking, including five-inch boards. These text records
support substrate/coating distinctions; no additional external visual reference
or refit has been substituted for the approved model.
