# Fletcher merge integration

The revision 4 hull, superstructure, Mk 30 gunhouses and propellers are preserved while integrating the current master branch's hull durability, equipment damage, flooding, diving, aircraft, maps, convoy presets and shell effects.

Depth charges use the common hull durability, local module and breach damage path. Actual hull HP lost earns damage score; a subsequent flooding loss earns one frag. The blast uses the submarine's current CPU depth, and a destroyer with usable depth charges remains in battle after its other ammunition is exhausted. Flooded or destroyed magazines disable launch stations through the shared equipment-availability rules. Trainable surface torpedo mounts retain their above-water launch path while fixed submarine tubes retain their depth restrictions.

The shell selector remains available for guns. Depth charges keep their release controls and omit gun ammunition and aim controls. Existing diving keybindings, carrier controls, tracer effects and convoy identities are retained.

The reviewed Fletcher content hash is `21547dc10500b4bf4ce24f8709a5276f6db3f05958261afedcd6f1f5914ea62e`. All five fixed views and seventeen matched views were regenerated and inspected. The geometry check passed with six closed blade solids and a minimum sampled barrel/enclosure clearance of 0.1599 m. Exact historical dimensions and fittings remain qualified in the discrepancy register.

All twelve retained ship assets passed the shared build pipeline, including the ten playable presets and two retired convoy aliases. The final integrated suite passed 514 tests across 63 files with 231,219 assertions and zero failures; TypeScript also passed. See [merge-tests.txt](merge-tests.txt) in the source reports.

The final loaded GLB passed eighteen gun and torpedo articulation poses in isolated Chromium 151 / WebGPU. Ten torpedoes launched and hit, eight depth charges launched and detonated, and reset cleared the effects. Turret closeups verified neutral, -15° and +85° elevation with recoil. Both propellers retained their origins and shaft axes when manually rotated in opposite directions. No browser page errors were reported. Runtime records and captures accompany the review pack; production build results are recorded separately in the source reports.
