# Subtler airborne shells

Reviewed 2026-09-06. [Open the interactive before/after comparison](index.html).

Shell bodies use darker warm steel. Glowing tips and tracer ribbons are half as wide at ordinary battle distances, with softer, less saturated amber light. Main-gun exposure decreases from 0.16 to 0.075 seconds (53% shorter), and the maximum trail length decreases from 150 to 72 m. Small calibers keep their existing exposure scaling. The physical body dimensions and CPU ballistics remain unchanged.

The reduced glow retains the depth-writing alpha cutoff needed to stay visible over Water Pro. Camera projection still accounts for range and binocular magnification. Trails terminate at the authoritative shell, grow only as far as its age allows, and disappear when a round lodges. These are gameplay visibility choices, not historical ammunition claims.

## Captures

| Battery | Before | After |
| --- | --- | --- |
| Main, eight shells | [Original](before-main.png) | [Subtle](after-main.png) |
| Secondary, six shells | [Original](before-secondary.png) | [Subtle](after-secondary.png) |

All PNGs are direct 1920 × 1080 canvas captures from the actual WebGPU game renderer, through Orca's embedded browser. The review uses `scripts/diagnostics/combat-effects.html`: medium quality, resolution 1, Bismarck broadside, 0.4 seconds after CPU firing; camera `[460, 105, 440]`, looking at `[260, 18, 0]`, 52° vertical field of view.

The original `CombatEffects.ts` came from commit `4ff855b8061588a817466af62bae009b6ccfe2b3`, imported from a temporary adjacent module. Only its three shell batches were made visible for the before frame; the current batches were used for the after frame. Both captures share the same paused simulation, renderer, ship poses, camera, smoke and ocean. Twenty settling frames precede each pair, with sky updates suspended during the pair. The temporary baseline module was removed afterward. No image generation, compositing or retouching was used for the PNGs.

## Verification

- 64 existing tests passed across combat, ballistics, AP projectiles, shell effects and shell-follow behavior.
- `bun run build` passed, including all ship/aircraft asset checks, TypeScript and Vite. The existing bundle-size advisory remains.
- [WebGPU and WebGL2 checks](browser-checks.json) passed: 0–256 visible shell instances, shrinking salvos, flight-trail pixels, end-on glow and pixel-free reset. Both backends report 58 visible trail pixels and end-on linear red brightness 67/255.
- The existing GPU fixture was brought up to date with the depth-charge array and the current 13-draw effect pool, which already includes aircraft smoke and depth charges. Its end-on contrast floor now matches the trail's 20/255 floor instead of requiring the prior bright glow's 100/255. The visual adjustment adds no draw calls.
- The design detector reported advisory colors outside the HUD palette; projectile materials intentionally use their own warm steel and amber shades.

Aircraft machine-gun effects, muzzle smoke and impact effects are outside this shell adjustment.
