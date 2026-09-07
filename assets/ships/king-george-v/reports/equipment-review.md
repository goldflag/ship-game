# KGV equipment implementation and AA source gate

The live preset replaces the hidden `support-director` proxy with six fixed station boxes: forward/aft main directors and four HACS stations. Main directors serve the three main mounts; the port/starboard HACS stations serve their respective 5.25-inch batteries. The fixed boxes follow the central housing positions in the original `build.py`; optical arms and cosmetic radar sweeps are not separate damage owners. Dimensions, HP, protection and coverage are gameplay approximations. KGV-006 and KGV-011 remain open historical limitations.

## Light AA: experimental component, no live registration

[Royal Museums Greenwich B9](https://www.rmg.co.uk/collections/research-guides/research-guide-b9-royal-navy-hms-king-george-v) identifies four octuple Mk VI pom-poms in the early outfit. The different December 1941 outfit is not used. B9 supplies the component's nominal rate, muzzle speed, projectile mass and elevation ceiling; traverse/reload behavior, stock, protection and damage remain gameplay choices.

The existing four decorative station positions have **not** been certified. The retained [Vickers NPB5315 drawing](https://www.rmg.co.uk/collections/objects/rmgc-object-59272) includes shelter/boat decks and is stamped 12 July 1941. It must not be treated as proof of a station coordinate merely because a circular gun platform is visible: the sheet also contains 5.25-inch mountings. The retained full-resolution NPB5308 profile and dated N31777 photograph help identify fittings, but this implementation did not resolve the necessary station datums and variant mechanism dimensions. No new coordinate measurement is claimed.

`../equipment-evidence.json` records each pom-pom ID, existing visual coordinate and unresolved status. Its `verified-only` policy excludes those stations from the compiled mounts. UP launchers also remain decorative. This implements the KGV-007 source gate from Fable's review; none of these fittings is advertised as firing in the live preset.

The original eight-barrel component, CPU poses, ammunition/AA path and export socket checks are implemented. A captured experimental ship definition/GLB and views live at `assets/reviews/damageable-equipment/octuple-prototype/`. The prototype is not in the runtime roster. Its four-by-two layout uses a common elevation axis and independent recoil, retaining stable eight-barrel IDs.

## Model acceptance record

- **Attachments:** original prototype pedestal, saddle, cheeks, row webs, feeds and sights are modeled. Closeups are retained; a complete contact audit through every pose is not certified.
- **Historical form:** KGV-005/006 priority shape issues predate this work and remain unresolved. Station coordinates and exact Mk VI mechanisms need dated dimensional evidence. In particular the outer-gun stagger/feed geometry is not certified by the current uniform-length prototype.
- **Exposed mechanisms:** the prototype has separate breeches, slides, bearings, feeds, lids and controls, but it is an initial reconstruction. It does not satisfy final variant-detail acceptance.
- **Articulation:** the exported prototype's 58 muzzle chains agree with CPU poses at intermediate train/elevation/recoil, including heel/trim. At high elevation, the closeup shows the nearby boom/rigging entering the barrel envelope; clearance acceptance is therefore open. Passing socket checks does not make that fit acceptable.

These are explicit blockers to promoting the prototype, not passed visual checks. The live preset retains its previous decorative AA geometry. Its final build, fixed views and browser checks are recorded with the fleet validation under `assets/reviews/damageable-equipment/`.

Local Blender 5.2.0 LTS was used; no Blender MCP capability was available. Generated outputs follow the normal ship compiler/build/check/review pipeline. Source drawings and the Bismarck baseline were not modified.
