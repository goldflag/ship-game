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
