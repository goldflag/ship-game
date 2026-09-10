# Claude Fable handoff: PvE fleet-command UI studies

Status: historical handoff, completed by Claude Fable. The user selected [variation D](pve-ui-studies/README.md): B for briefing/deployment, C for battle workflows, and no carrier aircraft information while following a ship. The decision supersedes conflicting requirements below, including aircraft controls in the follow view. The original brief follows for context; gameplay implementation has not started.

## Deliverable

Create a polished, standalone, interactive HTML artifact with **three materially different workflow/layout variations** for the new PvE experience. Include a variation switcher, screen/scenario navigation, working representative interactions, and a short comparison with your recommended direction and its tradeoffs. The user wants to see and try alternatives before choosing the implementation direction. Color swaps or screenshots of a single dashboard do not meet this request.

Write the artifact to `docs/pve-ui-studies/index.html` with a concise companion `docs/pve-ui-studies/README.md`. Keep the shareable HTML self-contained: inline scripts/styles and embed necessary assets or use verified absolute URLs; relative files are not uploaded by Orca. Prefer native HTML/CSS/SVG/canvas and existing original ship imagery over adding a framework or unrelated stock imagery. Clearly label the study as a design prototype using illustrative battle state.

Use the Orca CLI skill for the worktree browser and artifact delivery. Read its installed stub and the running CLI guide. Open the artifact in this worktree's Orca browser, inspect it, and publish the finished HTML as an Orca artifact when the user's artifact capability allows it. The user's request authorizes this design artifact; do not publish repository source, the full planning documents, private paths, or credentials. If sharing returns `artifact_sharing_disabled`, do not retry or change the setting: deliver the finished local artifact and explain the returned recovery instructions. Deliver the artifact link, local source link, comparison and recommendation in your final response. Do not merely provide instructions for the user to create the artifact.

## Source and ownership

- Work independently from current remote master in your Orca worktree. The handoff was prepared against `origin/master` at `1ac77b02827f3cdd1dc43749836ff083e9c296bc`; record your actual baseline.
- Read your checkout's AGENTS.md, README architecture/product sections, documentation index, `DESIGN.md`, current setup/deployment/fleet/air UI and shared controls. Use the current source for what already exists.
- Read the supplied `docs/pve-fleet-command-plan.md`, which records the new product direction and technical boundaries. Its Rust source review baseline is pinned and older than current master. Proposed mechanics in this study are not claims of existing implementation.
- The retained `docs/reviews/pve-fleet-command-fable.md` describes the original draft and is historical evidence. Do not reinstate its superseded aircraft counts, endurance recommendation or old deadline.
- The parent discussion checkout is `/Users/bill/orca/workspaces/ship-game/mermaid`. Read there only if a supplied file is missing; do not edit another worktree. Preserve the supplied plan/review/brief while creating the study and companion notes.
- Scope is design documentation and a throwaway interactive prototype. Do not implement combat, modify ship blueprints/generated models, integrate changes into master, push, or deploy the game. Do not rewrite global design tokens or `DESIGN.md` to make an unselected variation canonical. Do not delegate this task away from Claude Fable.

## Audience and visual direction

The user plays a game that currently emphasizes piloting one ship and is new to RTS fleet management. They should be able to command a fleet effectively without repeatedly correcting captains or manually piloting ships. This is primarily an Operate surface with the ship and sea continuously prominent.

Use the Impeccable skill for the UI study, following the existing world: naval instrument styling, maritime surfaces, ivory/mint/brass state colors, Barlow and Barlow Condensed typography, fine borders and restrained rounding. Read the actual incumbent CSS/components/assets. Preserve map and sea legibility; avoid replacing the game with an opaque dashboard or a new brand. The purpose, audience, style, constraints and requested multi-variation artifact are already supplied; proceed with these and record minor assumptions instead of restarting discovery or seeking approval to build the requested studies.

Vary interaction structure inside that world. Useful starting hypotheses, which you may improve with a clear reason:

1. **Map-led:** maximum tactical map with compact contextual orders and collapsible fleet/air controls.
2. **Task-group-led:** persistent surface-force and carrier-group organization, standing orders and exception handling.
3. **Selection-led:** clear selected-unit/group command area and progressive details, with an especially gentle transition from following a ship into fleet command.

Use the same fleet, contact situation and scenarios across all variants so they can be compared. Give all three comparable fidelity and access to every core workflow. Prefer layout and interaction differences over font/palette substitutions. Explain where each is easier for a novice and where it becomes slower or crowded.

## Confirmed product rules and prototype default

- PvE fleet elimination: physically lost or **permanently combat-incapable ships count as defeated**. Immobility alone or temporary repair/reload/service does not. Aircraft capability matters to whether a carrier is permanently unable to fight. Losing the followed or directly piloted ship is not automatic defeat.
- No default deadline; around 30 minutes is a pacing guideline. Show elapsed battle time rather than an invented countdown.
- Both teams have at most 200,000 metric tonnes, 15 ships as the initial cap, and 100 embarked aircraft including reserves. There is no carrier-count cap. Enemy composition and deployment vary coherently and scale to the selected friendly fleet. The player places friendly units; hidden enemy setup is frozen beforehand.
- **Enterprise and Shōkaku both carry 48 aircraft globally**, 16 fighters, 16 dive bombers and 16 torpedo bombers. This is a confirmed shared-preset inventory change, including Custom and online, to be implemented later through the ship pipeline. Preserve each carrier's national aircraft types. Do not add a separate PvE inventory fit.
- PvE uses groups of four: twelve groups per carrier. Six groups/24 aircraft start on deck, two groups of each role; the other six/24 start in the hangar. No airborne group cap and no fuel/endurance limitation. Timed lifts/launches, brief recovery reservations, quick deck rearm preserving damage, and slower hangar repair. Keep group identity understandable when individual aircraft return early or are lost.
- Fleet command is the normal control mode. Selection, camera follow and taking the helm are different actions. Captain autonomy handles steering, stations, lookout reports, normal weapons/AA, local detected-threat evasion and damage control. Focus fire does not authorize abandoning an escort. Torpedo commitment and strategic movement are explicit player decisions; routine execution is automatic.
- Carriers cruise within a player-assigned operating area or broad route; escorts follow. Ordinary flight-operation maneuver is automatic. The player handles major relocation and escort allocation. Manual wind alignment is not required.
- Prototype a **circle of radius 25 km, diameter 50 km**, with visible boundary and automatic captain turn-back. Radius is the user's suggested starting value and our recommendation, not a certified pacing result. Circle area is about 1,963 km², 23% larger than the earlier 40 km square. Keep opening fronts roughly 14–18 km apart and rear groups 6–10 km behind their own fronts. An illustrative layout has rear groups z=±16 km and fronts z=±8 km; extra area supplies maneuver room, not mandatory extra travel. Show legal circular deployment/route constraints and a subtle near-boundary warning. Disabled-ship exceptions remain an implementation detail.
- Surface forces contest the front and supply intel; carriers support that fight or attack the rear. Moving escorts between the front and rear is a meaningful tradeoff. Likely carrier regions can be predictable. Spotting's main value is current aircraft, destroyer, fighter and escort movements, plus current carrier position/course.
- Shared observed contacts with age/uncertainty; hidden enemies have no exact marker, roster count, HP or private readiness. A stale contact is a last report, not a live actor. Existing aircraft can search; no new specialist scout type is required. Search-and-strike can be sent toward a probable area without first visiting it with a scout; actual attack requires local acquisition.
- Large decisive strikes are acceptable. The prototype must not add an artificial airborne cap, mandatory second wave, fuel tax, capture points or hidden knowledge to force balance.
- Initial UI scope supports surface combatants and carriers. Submarines/ASW, convoy missions, campaign economy, online PvE, radar warfare and specialist scouting are deferred.

## Required workflows

Each variation should make these screens reachable and demonstrate the consequential transitions with actual local interaction, using a small shared mock state model rather than live simulation:

1. **Briefing and fleet selection:** mission/conditions, scaled-enemy explanation without exact enemy roster, live budgets, ship addition/removal, exact over-budget feedback, and an example containing both carriers (96 aircraft). Derive displayed tonnage from the authored definitions; do not invent historical or live-game statistics. Include a surface-only preset to show the mode works without carriers.
2. **Deployment and opening orders:** circular water/coastlines, legal friendly region, individual and formation placement, headings, carrier operating area, escorts and forward group. Make placement or an accessible equivalent work, display invalid placement feedback, and provide clear undo/reset/start actions. No editable enemy markers.
3. **Fleet command:** select one/multiple ships or task groups; route/hold/escort; focus fire independently of movement; explicit torpedo attack and return; standing-order feedback and tactical pause. Demonstrate that issuing a focus target leaves an escort assigned. Show local warnings without requiring constant roster inspection.
4. **Contact response:** fresh aircraft raid, stale destroyer report with age/uncertainty, lost contact/reacquisition, a surface breakthrough, and meaningful actions such as intercept, search last report or reposition. Do not show exact unseen enemy details through a side panel or scenario switch.
5. **Air operations across carriers:** filter by carrier/role, select several groups, search/patrol/escort/strike/recall, deck versus hangar, lift/launch/recovery/service queue, deck-full recovery handling, damaged group and an early-returning member. Show compact useful status first and per-aircraft detail on demand. Aircraft control must remain available while a surface ship is selected or followed.
6. **Follow/helm transitions:** make selection versus camera follow versus optional direct control obvious. Returning to fleet command preserves standing orders; a sunk controlled ship returns to a usable fleet view. Actual 3D piloting is not required in this prototype; demonstrate the interface transition coherently.
7. **Results and restart:** elimination outcome including permanent incapacity, observed versus debrief knowledge, restart same setup versus explicitly reroll a new battle. Present no live omniscient enemy totals before results.

Provide an unobtrusive demo-scenario selector outside the simulated game UI for dense, damaged, stale-contact and recovery-congestion states. Make the separation between prototype controls and proposed player controls clear. No dead prominent buttons: implement their local effect or visibly identify a bounded preview action. Include a resettable guided example such as assigning two destroyers to a carrier, focusing a reported target, then redirecting fighters to an incoming raid.

## Verification and delivery

- Inspect at desktop and compact laptop widths (for example 1440×900 and 1024×768), with a usable narrow fallback. Keep the map/sea visible, text legible and critical commands accessible; keyboard/pointer alternatives and labels must accompany colors. Do not rely solely on hover, right-click or unexplained modifiers.
- Use bounded visual inspection and interaction checks appropriate to a standalone prototype. Check variant switching, budget arithmetic, circular placement feedback, selection/command persistence, stale-contact rendering and both-carrier aircraft access. Run relevant skill checks on the study only; a mockup does not require Rust tests, model rebuilds or the full game build.
- Retain representative screenshots/evidence as allowed by current repository guidance. In the companion README describe variants, tradeoffs, key interactions, assumptions, known limitations and your recommendation. Record that gameplay/UI implementation awaits the user's choice after reviewing the artifact.
- Update your Orca worktree comment at meaningful checkpoints. At completion, deliver the actual artifact or local fallback directly to the user, identify the model used as Claude Fable, and stop before implementing the selected design into the game.
