# Naval sound set

13 one-shot sound effects are published in the game. The three gun reports (main gun A and B, secondary gun) are procedural, rendered by `scripts/audio/gunsynth.ts`; see [Procedural gun reports](#procedural-gun-reports). The other ten, and four archived beds, were generated with the connected ElevenLabs MCP on 2026-09-05. These are artistic game sounds, not recordings or claims of historical accuracy. No music or voices were generated.

`recipe.json` preserves every prompt or preset, requested duration, loop flag, format, and provider. For ElevenLabs clips, `originals/<cue>/` retains the unmodified MP3 delivered by `mcp__elevenlabs__text_to_sound_effects`; for procedural clips it holds `<cue>.wav`, rendered from the recipe preset. The first generation attempt returned a directory-not-writeable error before generation; creating the destination folders resolved it. All 17 subsequent generations succeeded. The account usage counter moved from 0 to 560 during this session; this is the reported counter, not a final billing statement.

## Rebuild and edit

Run `bun run audio:build`. After changing a procedural preset, run `bun run audio:synth` first (or `bun run audio:synth <cue>`). Python 3 and either FFmpeg or macOS `afconvert` are required. This is a local processing step with no API call or generation charge. Regeneration with ElevenLabs is nondeterministic; retain the selected original and update its recipe instead of replacing only a public asset.

The build decodes the selected originals, downmixes positional/interaction effects to mono, trims silent pre-roll and softens one-shot endpoints. The effects RMS target is −20 dBFS, limited by a −3 dBFS sample peak ceiling. High-crest-factor effects intentionally stay below the RMS target. This is RMS balancing, not a LUFS certification. PCM WAV outputs retain the processed samples without another lossy encode. The runtime contains only the 13 one-shot effects. Harbor, ocean, wind and engine originals are archived with `publish: false` and are neither exported nor loaded by the game; rebuilding removes their old public files.

The FFmpeg version shifts decoded MP3 samples slightly, so a full rebuild can rewrite every ElevenLabs output even though nothing about it changed. Commit only the clips you meant to change, and keep `build.json` hashes in step with the files you commit.

## Procedural gun reports

`gunsynth.ts` builds a report from seeded, filtered noise: a highpassed muzzle crack with a supersonic crackle; a blast of expanding gas that darkens within tens of milliseconds; a low boom with slow swells and a falling sub-bass drop; a mid-band roar whose lowpass closes as it rolls away; a rolling rumble behind the report; an eight-line feedback delay tail; and one sea-surface reflection of the crack, blast and boom. The sum is highpassed, soft-saturated and normalised. A preset and seed always render the same samples. The committed `originals/<cue>/<cue>.wav` is the reference output, so floating-point differences between machines never change the published files unless a clip is rendered again on purpose.

The presets were fitted, not tuned by ear. Coordinate descent adjusted their levels, filters and envelopes to match the band-energy envelopes of clean single shots from a World of Warships calibre comparison: 460 mm shots for main gun B, 356 and 406 mm for main gun A, and 130 mm for the secondary gun. The score compares ten bands from 20 Hz to 16 kHz on 100 ms-smoothed envelopes over 5–7 s, the first quarter second of the crack at 2.5 ms resolution, and how turbulent each band is. That analysis used the references only as measurements; no reference audio is stored in the repository, sampled or shipped. The fitted reports hold near full level for 1.5–2 s, then roll away over 5–7 s. The old ElevenLabs guns lost 40 dB within 1.5 s.

`build.json` records hashes, durations, channel counts and before/after peak/RMS readings. `public/audio/naval/` contains the processed game files and a copy of the manifest. No ElevenLabs key is shipped or needed at runtime.

## In-game use

| Cues | Trigger |
| --- | --- |
| UI click, confirm, back | Buttons, menus, selects and checkboxes |
| Telegraph, reload | Changed engine order; selected battery mount becomes ready |
| Ship horn | Departing port |
| Main gun A / B, secondary gun | Caliber-based firing events; simultaneous barrels in a mount share a boom |
| Armor hit, ricochet, splash | First impact per shell, without repeating every penetrated plate |
| Magazine explosion | Explicit simulation detonation event |

`GameAudio` reads CPU events and poses without changing the simulation. Positional sounds use camera-relative stereo, distance attenuation and low-pass filtering. One-shots are bounded: with 20 effects playing, the oldest tail fades out over 80 ms so the newest report is heard, and a compressor controls overlapping salvos. Pause stops combat tails. Port/ship/target resets clear audio event tracking. Hidden tabs suspend audio; disposal closes the context and removes listeners.

Sound starts after the first click or keypress, as required by browser autoplay rules. **Settings → Sound** has master, effects, interface and mute controls, plus preview buttons. Sound settings apply immediately and are saved separately from graphics settings.

There is no continuous ambient playback. Saved preferences from the initial iteration discard the obsolete ambience field. A dedicated sinking hull sound, shell flybys and individually authored gun sounds for every caliber remain possible extensions.
