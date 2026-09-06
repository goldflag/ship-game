# Fletcher merge integration

The revision 4 hull, superstructure, Mk 30 gunhouses and propellers are preserved while integrating the current master branch's equipment damage, flooding, diving, aircraft, maps, convoy presets and shell effects.

Depth charges use the common local module and breach damage path. Actual equipment loss earns damage score; a subsequent flooding loss earns one frag. The blast uses the submarine's current CPU depth, and a destroyer with usable depth charges remains in battle after its other ammunition is exhausted. Flooded or destroyed magazines disable launch stations through the shared equipment-availability rules. Trainable surface torpedo mounts retain their above-water launch path while fixed submarine tubes retain their depth restrictions.

The shell selector remains available for guns. Depth charges keep their release controls and omit gun ammunition and aim controls. Existing diving keybindings, carrier controls, tracer effects and convoy identities are retained.

The reviewed Fletcher content hash is `21547dc10500b4bf4ce24f8709a5276f6db3f05958261afedcd6f1f5914ea62e`. All five fixed views and seventeen matched views were regenerated and inspected. The geometry check passed with six closed blade solids and a minimum sampled barrel/enclosure clearance of 0.1599 m. Exact historical dimensions and fittings remain qualified in the discrepancy register.

Final full-suite, production build and runtime validation results are pending completion of the shared asset rebuild.
