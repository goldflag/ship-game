# Water Pro (licensed, comparison only)

The commercial Water Pro 3.5.1 ocean. The game's own ocean in `src/game/ocean` replaced it; the bundle
stays here only so the developer console's "Switch ocean renderer" can compare the two in the real
game, through `src/game/comparison/WaterProOcean.ts`. The default game never downloads it.

## Never read the bundle

[LICENSE.md](LICENSE.md) section 3.6 forbids decompiling, disassembling, deobfuscating or otherwise
reverse engineering the compiled code. Do not open, read, grep, diff or pattern-match
`build/index.js`, in this or any revision, directly or through a tool or subagent. The same rule
covers Sky Pro's `vendor/threejs-sky-pro/build/index.js`. See the clean-room rule in
[the ocean's README](../../src/game/ocean/README.md#clean-room-rule).

What you may use:

- The declarations: `build/**/*.d.ts` (`WaterSystem.d.ts`, `uniforms.d.ts`, `types.d.ts` and the
  per-folder files). `.ignore` skips all of `vendor/*/build/`, so name a declaration file to search
  it: `rg pattern vendor/threejs-water-pro/build/WaterSystem.d.ts`.
- [PATCHES.md](PATCHES.md), for what the vendored copy changed and why.
- Runtime observation through the public API the adapter already calls: captures, frame times and
  values read back from the running game.

PATCHES.md records hand edits made to the bundle before the game had its own ocean. It is history,
not a procedure: patching the bundle means reading it, so nobody patches it again. A change the
comparison needs goes in the adapter or in the game's own ocean.
