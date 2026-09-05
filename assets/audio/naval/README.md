# Naval sound set

13 one-shot sound effects are published in the game. All 17 original sounds were generated with the connected ElevenLabs MCP on 2026-09-05. These are artistic game sounds, not recordings or claims of historical accuracy. No music or voices were generated.

`recipe.json` preserves every prompt, requested duration, loop flag, format, and provider. `originals/<cue>/` retains the unmodified MP3 delivered by `mcp__elevenlabs__text_to_sound_effects`. The first generation attempt returned a directory-not-writeable error before generation; creating the destination folders resolved it. All 17 subsequent generations succeeded. The account usage counter moved from 0 to 560 during this session; this is the reported counter, not a final billing statement.

## Rebuild and edit

Run `bun run audio:build`. Python 3 and either FFmpeg or macOS `afconvert` are required. This is a local processing step with no API call or generation charge. Regeneration with ElevenLabs is nondeterministic; retain the selected original and update its recipe instead of replacing only a public asset.

The build decodes the selected originals, downmixes positional/interaction effects to mono, trims silent pre-roll and softens one-shot endpoints. The effects RMS target is −20 dBFS, limited by a −3 dBFS sample peak ceiling. High-crest-factor effects intentionally stay below the RMS target. This is RMS balancing, not a LUFS certification. PCM WAV outputs retain the processed samples without another lossy encode. The runtime contains only the 13 one-shot effects. Harbor, ocean, wind and engine originals are archived with `publish: false` and are neither exported nor loaded by the game; rebuilding removes their old public files.

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

`GameAudio` reads CPU events and poses without changing the simulation. Positional sounds use camera-relative stereo, distance attenuation and low-pass filtering. One-shots are bounded; a compressor controls overlapping salvos. Pause stops combat tails. Port/ship/target resets clear audio event tracking. Hidden tabs suspend audio; disposal closes the context and removes listeners.

Sound starts after the first click or keypress, as required by browser autoplay rules. **Settings → Sound** has master, effects, interface and mute controls, plus preview buttons. Sound settings apply immediately and are saved separately from graphics settings.

There is no continuous ambient playback. Saved preferences from the initial iteration discard the obsolete ambience field. A dedicated sinking hull sound, shell flybys and individually authored gun sounds for every caliber remain possible extensions.
