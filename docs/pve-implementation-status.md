# PvE implementation status

Objective: implement the complete [PvE fleet-command plan](pve-fleet-command-plan.md) with the user-selected [variation D](pve-ui-studies/README.md). Partial milestones do not complete this objective.

Implementation checkout: `goldflag/pve-fleet-command`, created from current remote master `b321cbf8a524edb16bdbcd56a3944eda8fd7a774` (includes Iowa and Mogami). The discussion checkout and Fable study are preserved separately. The approved HTML is retained byte-for-byte with its recorded hash.

## Work and evidence

| Scope | Status / evidence required |
| --- | --- |
| Approved design / decisions | Copied plan and selected D study; incapacity elimination, visible 25 km radius, global 48-plane 16/16/16 inventories confirmed |
| Fleet command authority | Implemented Rust routes, station-keeping, escort, focus, weapons policy, explicit helm release and owner-only acknowledged order projection; real-WASM control-transfer and all-carrier addressed-order tests pass. Attack/torpedo tasks and rally/Execute remain pending |
| Navigation / formations | Four real authored-hull physics tests pass: multi-waypoint arrival, catch-up/leader loss, island detour, carrier + three-destroyer passage and turn with reformation. Damaged stragglers, moving-threat evasion and full combat acceptance remain pending |
| Variation D command UI | Initial compact roster/card, multi/box selection, named numbered control groups, move/escort/focus, weapons, all-carrier air drawer, follow/helm and local tactical pause wired. Live browser confirmed acknowledged escort and queued hold while time stayed fixed. Revised desktop capture inspected after correcting automatic HUD scale. A delayed worker snapshot can no longer restore helm during a paused transfer. Compact/follow and native-input confirmation remain pending. Contacts now show acquisition state, age, affiliation and uncertainty; the map shows the circular limit. Keyboard, complete mission and logistics UI remain pending |
| Sensors / tracks / projection | Rust visual acquisition, identification, terrain/horizon checks, physical aircraft signature and stale measured-motion tracks implemented; five sensor tests pass, including hidden-motion perturbation after reporter loss. Surface captains/guns use reported motion and uncertainty; AA requires a current local aircraft observation. Rust team projection omits enemy Combatants, private events/records and exact fleet totals. Four real-hull observation/projection tests and real-WASM client cases pass. Aircraft mission targeting/search, confirmed sinking/condition reports and the full information-flow/visual audit remain pending |
| Mission / setup / generator | Versioned content-validated mission policy, 200k-tonne/15-ship/100-aircraft budget, circular placement/order validation and physical turn-back, permanent-incapacity predicate, simultaneous draw and no default deadline implemented in Rust. Six authored-hull mission checks pass. Scaled seeded generator, private frozen setup, deployment UI, restart/reroll and complete mission workflow remain pending |
| Global carrier inventory | Pending durable authoring, compiled/hash/model outputs for both 48-plane 16/16/16 wings, Custom/online validation and required pipeline review |
| Carrier logistics | Pending four-plane groups, 24 deck/24 hangar, no airborne cap or endurance, handling/service/recovery, stable group identity, conservation and full sortie checks |
| Combined fleet tactics | Pending captain-driven rear movement, all-carrier commands, manual friendly launch policy, search/strike/CAP, forward/rear allocation, loss handling |
| Balance / performance | Pending paired full-wing versus reconnaissance/support playtests, meaningful surface participation, bounded cleanup, actual browser WASM measurements up to 30 ships / 200 aircraft |
| Final validation | Pending relevant Rust/TS tests, multiplayer checks and build, exact asset checks/reviews, runtime visual/interaction verification, requirement-by-requirement plan audit |

Legacy Custom/online policies remain selected defaults except for the explicitly global inventory change. The full objective remains active until all required gameplay, UI, model and validation work is complete.

## Foundation verification (2026-09-08)

- Full Rust workspace validation passes: 64 tests. Clippy initially reported one manual-clamp idiom; after correction, warnings-as-errors Clippy passes. The rebuilt WASM passes all migration checks, including 28,800 full battle ticks. No migration fixtures were regenerated.
- Production `bun run build` passes with the revised command UI, transfer fix and mission/sensor additions. Ship and aircraft asset checks pass for the unchanged models; this does not certify the pending inventory rebuild.
- Eight real-WASM snapshot-session tests pass, including explicit release/resume and commands to two carriers while a destroyer keeps the helm. Three outbox tests exercise ordered resume, overflow, supersession and invalid escort admission.
- Game/input/render tests pass, including an additional real-session selection/follow/helm regression that checks held input is not cleared each render frame.
- The pinned Bun 1.3.3 runtime passes 45 tests across session/Game/input files, including the delayed-transfer regression, against the rebuilt WASM. The globally installed older Bun lacks `DecompressionStream` and is not the verification runtime.
- Mission profiles enter the content manifest hash; mission and sensor assets enter the simulation build hash. Missing or altered mission profiles fail validation.
- Native source and generated protocol bindings use protocol version 4. Browser workers and server must be built from the same version.
- Browser evidence is temporary in `.build/pve-ui/`. Orca CDP screenshots were intermittent on the background tab; desktop capture succeeded after viewport adjustment. Browser actions were additionally exercised through DOM events because some native ref clicks did not reach their intended controls. This does not certify native pointer input or foreground performance.

Next required work: private seeded opponent generation and frozen deployment, D briefing/deployment and a complete playable surface mission; then remaining command tasks and the carrier slices. The circular map UI is implemented but still needs real-view verification. Global inventory rebuilding and carrier logistics remain pending.

## Observation integration checkpoint (2026-09-08)

- PvE surface bots acquire, aim and maneuver from opaque observation tracks. Focus accepts only the owning team’s targetable contact IDs; true enemy IDs and unseen targets are rejected. Own crew damage and physical collision/terrain checks remain authoritative. Legacy targeting is preserved for Custom/online.
- The Rust production projection requires an explicit audience. PvE serializes owned ship/air-wing state and whitelisted observations/effects. Hidden hull damage is not serialized into that intermediate frame. Team event admission happens when an event occurs, with its own sequence; hidden past events cannot become newly disclosed when the player moves closer. Complete enemy state is available only in the finished debrief payload.
- Client telemetry now distinguishes a full selected actor, a selected report, and no target. Unknown enemy tonnage and no deadline remain explicit values. Contact selection cannot open enemy internals.
- D’s map has report markers, classification/identification, age, uncertainty rings, observer provenance and the visible 25 km limit. Contact and air panels remain map-only. Mission departure enters fleet command without taking the helm.
- Observed exteriors have no Combatant or inspection data. A ship camera needs that ship’s own visual observation; the map can use permitted team observations. Recognition templates are loaded from the public catalog independently of the hidden roster. The rendering adapter’s camera-permission test passes; actual silhouette/camera transitions and loading cost still require browser review. The Orca page remained in harbor warmup after rebuild reloads; no new battle visual evidence is claimed.
- Native observation tests cover unobserved targets, hidden-course/damage perturbation, private snapshot data, opaque contact selection and exterior withdrawal when observations lapse. The rebuilt WASM passes 27 client/control/render tests and the migration suite’s 28,800 battle ticks. One separate display-rate determinism test exceeded its default five-second timeout under concurrent work, then passed with a 60-second allowance.
- A production build passed. The complete Rust/multiplayer checks pass after the final projection optimization: native workspace tests, warnings-as-errors Clippy, rebuilt WASM and all migration checks. The final production build also passes. No migration fixtures or models have been regenerated.

This is a surface-observation milestone, not completion of fog of war or the PvE mode. Carrier orders still need the planned observation-aware air commander; the old five-second launch script is disabled only for missions. The private setup workflow, enemy coordination, air rules and complete mission UI remain required.
