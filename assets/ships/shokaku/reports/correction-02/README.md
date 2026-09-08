# Window, island and stern correction

The user's report was correct: the previous model had bridge-window z-fighting and inaccurate island/stern shapes. Its earlier acceptance of those features is superseded. The [before snapshot](before/) retains the original blueprint, recipe, definition, Blender scene, acceptance and matched actual-game cameras at hash `16bd50f50408f1a02ed6a0635aaa585a7ae182000b30de6bb7b4ffe5146ef890`.

The corrected model is `2d43863548c9dfcee9b1822b75dee70d501d16271e334d13ce5c1accfd00c0b8`. Durable changes are in [the blueprint authoring recipe](../../authoring/generate_blueprint.py), [blueprint](../../blueprint.json) and [Blender recipe](../../build.py).

| View | Before | Corrected model |
| --- | --- | --- |
| Island from forward | [Original](before/island-forward.png) | [Corrected](../geometry-2d438635/island-forward.png) |
| Island from aft | [Original](before/island-aft.png) | [Corrected](../geometry-2d438635/island-aft.png) |
| Stern quarter | [Original](before/stern-quarter.png) | [Corrected](../geometry-2d438635/stern-quarter.png) |
| Stern center | [Original](before/stern-center.png) | [Corrected](../geometry-2d438635/stern-center.png) |

The [original window regression](before/windows.json) fails on 54 panes coincident with opaque walls. The replacement cuts actual openings, recesses the glass 85 mm and models the jambs and rain hoods. All 14 panes [pass](../geometry-2d438635/windows.json), with no coplanar wall behind them. The window band is confined to the forward conning section; the aft room has a porthole.

The bridge had confused balcony tops with deck floors, producing excessive height and repeated concentric terraces. Floor heights are now 14.75, 17.06, 19.46 and 21.64 m, following the four distinct floor lines in the uniformly scaled S02 profile. Each tier has its own length and footprint; lower galleries have open rails, upper platforms have solid bulwarks, and the lower room extends under the flight-deck edge above a braced launch gallery. The roof director is placed aft. [Profile/plan registration](../geometry-2d438635/registration.json) records the landmarks and its limits.

The stern now has a rounded upper hull, rising afterbody, two levels of boat stowage, deep portal supports, a fixed port derrick and a curved flight-deck round-down. The original identical box rudders are replaced with distinct rounded tandem profiles. Their tips are translated to the nominal 8.87 m draft and their concealed crowns fit the authored hull through the reviewed turning range. Thickness and hidden afterbody sections remain reconstructions; the changed hull's buoyancy/CG and flood reserves were regenerated through the shared authoring tools.

S02 is a modern secondary arrangement, not an authenticated 1941 shipyard plan. The dated **23 August 1941** photographs in [S10](../../references/sources.json) corroborate the visible island and stern configuration. S11 records a modern artist's related plan without asserting unproven authorship of the exact S02 raster. Floor-fit residuals below 0.02 m measure agreement with that raster, not historical precision. Original offsets and small local dimensions remain unresolved.

The [final review](../acceptance.md) retains all four required visual checks, the connected 12,799-mesh attachment graph, 11,484 gun poses, independent neighbors, rudder clearance, in-game articulation and gameplay checks for this exact model hash. **892 tests pass; the production build passes.** Intermediate hash folders retain failed checks where they occurred, including the rudder crown clash corrected before this final build.
