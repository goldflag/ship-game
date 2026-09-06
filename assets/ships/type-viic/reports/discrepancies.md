# Type VIIC discrepancies and scope

The export checks establish dimensions, sockets and hierarchy, not historical accuracy. This is a generic early-war 1941 Type VIIC, not a certified reconstruction of every U-570 fitting.

| Area | Status / approximation |
| --- | --- |
| Hull | Nominal overall length/beam/draft and surfaced mass cross-checked; original station widths and contours remain estimated. Pressure hull and outer casing are represented by one collision envelope, not separate watertight shells. Saddle shoulders and end curvature need a calibrated section study. |
| Tower and deck | Plan/photograph-informed placement; tower curvature, platform, drainage pattern, rail spacing, rigging, hatches, screw blades and control surfaces are original simplifications. Camouflage, markings and boat-specific refits are omitted. |
| Guns | Shared open-mount geometry adapted to separate 88 mm and 20 mm catalog parts; breeches, sights and seats are approximate. Gun HP/armor volumes and AP performance are gameplay values. |
| Tube sockets | Four bow and one stern IDs/positions/directions are validated. Muzzle positions and closures are estimated; tube doors do not animate. |
| Torpedo supply | Four bow tubes have three rounds each; stern has two. This consolidates internal and external reserve storage into per-tube ammunition. External reload handling is not recreated. |
| Torpedo motion | One 44 kn / 5 km G7a setting; gyro offset is applied immediately within ±15°, followed by an unchanging straight course. The weapon does not inherit the ship’s forward velocity. Depth settles at 0.6 m/s to 2 m. No homing, magnetic pistols, reliability failures, pattern running or detailed gyro-turn radius. |
| Arming / damage | 300 m arming, 45 s reload, 0.7 s launch interval, 340 HP contact damage and 1.6 m² breach are explicit game tuning. Contact uses the centerline swept segment; no blast propagation or empirical torpedo-defense system. One nearby module can be damaged, with the shared 150 HP magazine penalty. |
| Existing hulls | Torpedoes derive collision surfaces from blueprint hull stations independently of armor. Unequal point counts are resampled to 33 height samples per station. Presets without detailed sections use their width/keel/deck tables as a coarse envelope. |
| Internals | Six compartment envelopes follow machinery order. Box sizes, capacities, pump rates, waterplane area and reserve buoyancy are tuned estimates. No electrical battery energy simulation or crew tasks. |
| Diving | Surface sailing only. Submergence controls, ballast, periscope operation, oxygen, sonar and depth charges are outside this first update. Hydroplanes, screws and rudders retain stable independent pivot empties for later work. |
| Reference access | U-boat Archive public files retained after a certificate hostname mismatch; see source register. No GameModels3D or other game geometry or textures were read by the production recipe. |
