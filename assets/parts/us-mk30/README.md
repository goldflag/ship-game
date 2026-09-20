# US 5-inch/38 Mk30

Original enclosure, elevating shield, weather sleeve, barrel and gunhouse fittings extracted from the Fletcher recipe. Uses catalog facets and the shared articulated joints; no generated model is an authoring input.

The existing `us-5in38-mk30-single` preserves its original approximate configuration. Extraction does not resolve the catalog’s Mod18/Mod0 fidelity limitation or certify visual acceptance. Compare exact variants before fitting another ship.

`bun run part:build us-5in38-mk30-single`

The 2026 component pass keeps the weather sleeve on the elevating shield while
the gun recoils through its cuff. Twelve-sided smooth gun tubes, a reduced
shield arc and fabric grid, and removal of small train-ring fasteners reduce
triangles without changing joint/socket IDs or weapon travel.

The published Mk30 Mod0 main-battery variant has a 3,372-triangle whole-assembly
ceiling from 13e3e07. Its broader rolled shoulders, low apron and central rear
trunk replace the inherited Fletcher door/ladder pattern. The exact mounting
interface, pivot, muzzle and recoil contract are retained. Apron scallops, rear
trunk taper and canvas detail remain simplified. The older Fletcher Mk30 is not
a published Shipbuilder entry and its geometry is unchanged by this pass.
