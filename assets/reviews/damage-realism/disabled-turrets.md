# Disabled turrets and surviving weapons

The primary-armament knockout experiment in `67f5fc3` has been removed at the user's request. Every usable gun and torpedo counts toward fighting strength again. Surviving secondary guns keep aiming and firing after the main battery is destroyed. No replacement ship-status label was added. The stronger AP direct equipment-damage budget remains at 75% of nominal damage.

## Turret movement diagnosis

The CPU already stopped aiming a destroyed turret, or one without magazine supply, on subsequent ticks. Regression checks confirmed that changing aim and helm commands cannot move these turrets, for both player and bot ships. A flooded magazine can recover and allow aiming to resume.

Two timing gaps were reproduced. Gun training happens before impacts in a fixed tick. A hit that disabled a gun or magazine could leave the mount's status as `turning` until the next tick. The renderer also interpolated between its previous and current angles after disablement, so the model finished a small part of its turn on later display frames. This reproduction covers a brief movement at failure, not sustained autonomous turning of a destroyed mount.

Capability updates now publish individual mount failures during the damage tick. The renderer applies disabled mounts' authoritative train and elevation directly, without completing that interpolated turn. Recoil interpolation remains separate. A disabled turret remains attached to the moving hull; its local joints stop moving.

The regression loads Baltimore's actual exported joint hierarchy, trains a gun, disables it in the same tick, and checks yaw and elevation at multiple display interpolation fractions. It then changes aim and helm over 120 further simulation ticks and verifies that the turret remains fixed. Separate CPU tests cover gun destruction, magazine destruction, temporary flooding and recovery.

## Combat behavior and evidence

Regression coverage demonstrates that both player and bot secondary batteries fire after all main guns are destroyed. Main-battery loss earns actual damage score but no frag while a secondary gun survives. A later sinking still awards the single frag. Fleet counts keep the armed ship active and the HUD adds no special label for main-gun loss.

The previous [knockout measurements](knockout-balance.md) remain as historical evidence of the rejected rule. [Current seed-12345 runs](secondary-survival.jsonl) use the same 5 km stationary broadside fixture and stronger AP damage, with surviving secondary weapons now included. They are controlled tests, not estimates of historical battle duration.

No ship definitions, models or recipes changed. Joint behavior was checked against the existing exported models; no asset rebuild is required.

Validation: `bun run test` passed all 388 tests across 50 files. `bun run build` passed the five ship checks, aircraft checks, TypeScript and Vite. The existing large-bundle warning remains.

After integrating the concurrent camera/rendering update `1cf301c`, all 35 affected camera, gun-aim, HUD and exported-joint checks passed, and the production build passed again.
