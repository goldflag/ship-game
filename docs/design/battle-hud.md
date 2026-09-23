# Battle HUD: commands, aiming, helm, minimap, gunnery, depth and damage feedback

Moved verbatim from [DESIGN.md](../../DESIGN.md) on 2026-09-19 (rewrapped, relative links adjusted).
DESIGN.md keeps the tokens and rules; this file keeps the detail and rationale.

### Commands and navigation

Set sail is a solid brass command. Secondary actions use transparent or maritime fills and fine
borders. Selected model views use a brass underline; selected Fleet action battery controls use mint
borders and keycaps. Engine orders, camera, chart range, pause, fullscreen and HUD visibility remain
functional. The native pause dialog contains focus; hidden instruments are inert. Reduced-motion
preference removes interface transitions and the port entrance animation.

**The App Focus Rule.** At the owner's request, the shared app stylesheet suppresses CSS focus
outlines across the game and standalone Shipbuilder while retaining focus and keyboard activation.
Keyboard-focused buttons, links and summary controls use an underline with a 3 px offset. This
replaces the earlier game focus-ring guidance; tools that do not load the shared app stylesheet
retain their own styling.

### Sailing aim and binoculars

Mouse movement aims through the centered sailing sight while the cursor is captured. Shift or right
mouse toggles binocular view. The numbered horizontal aiming scale appears only in binocular view,
alongside range and magnification. Scrolling continuously adjusts 1×–32× binocular magnification;
ordinary scrolling eases camera distance. Optics transitions preserve the aimed point over 0.42
seconds and respect reduced motion. Surface binoculars look from a fixed 30 m above the bridge at
every range, for a slightly steeper view of the sea; submarine periscopes retain their physical eye height.
Downward chase tilt orbits toward a near-vertical view above the
hull. Hold Ctrl to release the cursor for HUD controls, then release it to resume captured aim. A
visible prompt offers capture when the cursor is free. Esc pauses or resumes through the pause
dialog. Camera cycling and recentering remain keyboard actions (C and R).

Optical rangefinding extends the scope readout with a compact target name, acquisition
countdown/progress, measured range and explicit tracking/locked/contact-lost states. G starts a
three-second observation inside a forgiving dashed circle; L locks elevation while preserving
horizontal aim. The crew updates the range while the target remains visible, and a lost contact
retains its last measurement. Brass identifies a range lock; text always explains it. Rebindable key
hints follow Settings, H hides ranging instruments, and short landscape views place the status below
the sight to clear the compass. Optics remain usable from 1× through 32×.

### Ship condition and helm

The lower-left group combines the ship silhouette and name, live current / maximum HP and its
proportional bar, a circular compass with ship heading, camera bearing and selected-battery gun
marks, speed in knots, a vertical engine telegraph and the rudder indicator. HP represents gameplay
hull durability; exhausting it starts sinking. Gunnery shows equipment condition separately, and
flooding and stability can also sink a ship with HP remaining. The selected engine order has mint
lettering and a pointer on a transparent surface; W/S step the order, Space stops, and A/D steer.
Flooding appears with its measured volume when present. The compact rudder instrument is at most 180
px wide with 26 px-high notch buttons on desktop and has five persistent orders, from full port
through amidships to full starboard. A/D step one notch per press. Click or tap a labeled notch to
set it directly; mint marks the order and a gold marker shows actual rudder position. Remove the
steering keycaps. Coarse-pointer notch targets remain at least 44 px high, with the instrument
allowed up to 220 px width.

### Navigation minimap

The north-up chart follows the ship and shows its heading, camera view cone, course trail, trial
target and marker buoys. NORTH UP is a static orientation label. The kilometer readout cycles the
radius through 1, 2, 4 and 8 km, starting at 2 km. Separate −/+ buttons and keyboard shortcuts
adjust the five map sizes; endpoint buttons disable at the smallest and largest sizes. Range and
physical map size remain independent.

### Live gunnery

The armament group shows circular reload progress and readiness for each selected gun mount, torpedo
tube or depth-charge station, with mount numbers, remaining seconds or a ready mark. Its heading
pairs the battery name with a can-fire/total count and includes caliber or tube diameter for guns
and torpedoes. Only eligible, loaded weapons count; unavailable mounts show a cross. Gun-aim circles
distinguish Turning, Out of arc, Out of range and Blocked, and any visible seconds are labeled
Reload. The circles and firing use the same eligibility state. The baseline five slots contain main
AP, secondary AP, binoculars, gunnery and fire. Fitted torpedoes add a sixth slot between secondary
AP and binoculars; fitted depth charges add a seventh after torpedoes. Both use the same mint
selection state, keycap and live ammunition count. Ammunition illustrations, including the
depth-charge drum, are independently authored SVG assets; all ammunition totals come from live
simulation telemetry. Keyboard 1/2 selects main or secondary AP, 3 selects fitted torpedoes and 4
selects fitted depth charges. Q or left mouse fires the selected weapon group. The firing action is
disabled when no selected weapons are ready.

For Type VIIC, selecting torpedoes shows five tube-readiness rings and the remaining ammunition from
its initial 14 rounds; readiness also respects the submarine's current depth. A compact muted line
beneath the battery heading gives the bow/stern arcs, range and arming distance. Translucent mint
sectors follow the water surface, with a gold arming arc and a straight-course line; a brighter
narrow cone marks a ready launch. Hide this preview outside torpedo selection, during inspection or
shell follow, on loss of the player ship, and with H. The port characteristics show five 533 mm
tubes and 14 rounds. Gunnery labels its action Launch and explains that each press launches one
eligible loaded tube, holding launches tubes in sequence, and Target waterline supplies lead for the
selected target. Keep straight-course behavior explicit in that help. The target-condition readings
include depth when available.

Fletcher's torpedo selection shows ten tube-readiness rings and its remaining stock from ten rounds.
The same muted help line gives the trainable broadside sectors, range and arming distance; readiness
distinguishes a loaded tube from one still turning toward aim. Depth-charge selection shows eight
station-readiness rings and the remaining stock from 28 charges. Its fourth weapon button is labeled
DEPTH with keycap 4; the firing action becomes Drop. The two-line help identifies stern racks and
side throwers, the 10 m burst depth, and the need to make a close pass and keep moving clear.
Gunnery labels ready stations “Ready to release,” omits the aim selector for this weapon, and
explains one press versus a held pattern and possible damage to the player's ship and allies. Use
the inherited maritime surfaces, mint readiness, brass gunnery command and Barlow instruments for
these added states.

G opens gunnery and releases the cursor for aim selection, trial-target condition, flooding,
inspection and reset. Keep inspection exit controls reachable when details collapse. Only
implemented combat features appear as live telemetry. Do not fill spare weapon slots with
unsupported ammunition or consumables.

### Depth and ballast

Submarines add a compact transparent instrument. Barlow Condensed leads with actual depth in meters;
compact Barlow text carries the ordered depth, movement state, ballast percentage, propulsion mode
and vertical speed. Tabular numerals stabilize the changing readings. Mint identifies the depth
meter, movement state and selected preset; a gold marker shows the ordered depth.

Surface, Periscope and Dive 50 m form the preset row, followed by paired Rise 10 m / Dive 10 m
adjustments. Emergency blow occupies its own full-width row with gold lettering. Selected commands
expose their pressed state, unavailable adjustments disable at the order limits, and sinking
disables depth commands. Keyboard hints follow the configured bindings. Depth-limit and weapon-depth
warnings state the corrective action beside the controls.

**The Actual and Ordered Depth Rule.** Keep achieved depth and commanded depth separately labeled,
with actual depth filling the meter and the order marked independently. Show ballast, propulsion and
movement state from live telemetry so the player can inspect the response to an order.

### After-action report

A decided battle replaces the instruments with the after-action report (`src/ui/report/`): the outcome
and elapsed time at the top, two underlined tabs, and the exit commands (Battle again, New battle,
Return to port) at the foot. It waits for the player; only an interrupted or abandoned battle keeps
the short notice and its countdown. The sea stays visible under a dark scrim and nothing carries a
panel fill except the selected hit's card, which is styled as a tooltip.

**Battle results** sets the fleets side by side, mint for yours and salmon for the enemy: damage dealt
as the headline, then per ship its state (afloat with integrity, sunk with time and victor), damage
dealt, taken and blocked by armor, hits against shots fired, ships sunk and a by-weapon bar. Fleets
of more than four fold to one line per ship. A stepped chart of both fleets' damage over the battle
runs beneath, with each sinking marked. A ship's name opens its hits.

**Your ship** turns the ship's own model on a turntable (drag to turn, scroll to zoom) with one mark
per projectile where it first struck: salmon fill for a penetration, gold for high explosive, a salmon
diamond for a torpedo or depth charge, a hollow mint ring for a hit the armor stopped. Larger marks
did more damage; marks on the far side of the hull fade. Selecting a mark, or a mark on the timeline
below, shows the weapon and firer, what was struck, the plate with its thickness, obliquity and
effective thickness, the outcome, the damage, and each module damaged or destroyed and room opened to
the sea. The debrief reveals both fleets, so the picker lists every ship.

The data is the simulation's after-action record (`naval-sim` `records.rs`, `AfterAction`), carried
only by a decided battle's debrief: up to 400 hits a ship, least damaging dropped first and counted.

### Hull damage feedback and score

Incoming shell hits add a salmon arc and outward tip around the sight, pointing toward the source
relative to the active camera. Bearings stay attached to the incoming direction as the camera turns,
including binocular and shell-follow views. Armor stops and ricochets count even without equipment
damage. Nearby directions combine; at most six cues remain visible. Each holds for 1.2 seconds and
fades over one second of simulation time, so pause freezes it. Keep the sight center clear, use a
dark stroke for contrast over sky and sea, and follow H and port visibility.

Gold marks your actual hull damage beside overhead ship labels and in the vacated section of their
bars; pale blue marks damage from other sources. Detailed impact labels use the same colors. Hits
within 0.35 seconds combine into separate totals for your damage and other damage; the segment holds
for one second after the latest hit and fades over 0.6 seconds. Simulation time freezes these cues
during pause. The player's lower-left hull instrument uses the same gold segment and a numeric
damage notice above it, with no screen-covering tint. Feedback uses opacity only, without camera
shake or movement.

The compact Damage / Frags reading sits below the upper-right pause control, with a mint Armor
blocked total immediately below it. Armor blocked counts potential hostile shell HP prevented by
armor stops, ricochets and rejected HE fragments, using the loaded ammunition’s damage value minus
any hull damage the same shell ultimately causes, once per finished shell and defended ship. It
resets with the battle and survives snapshot/reconnect updates. Its damage log is three single-line
entries high (two on compact screens), with a fixed scrollable footprint and no heading, frame,
surface fill or empty-state message. Each entry shows weapon, other ship and signed damage; hover
text retains time and hit details. The battle tally occupies the upper-left edge; its roster unfolds
only while the cursor is free, without a target dropdown or floating panel. Damage counts actual
hostile hull HP removed on the displacement-based scale; frags count permanent combat losses or
sinkings credited to the last hostile damage or breach, including delayed flooding. Both reset with
the battle. The bottom armament ends with its weapon keycaps: the Follow shells row and
Ctrl/Shift/Esc hint strip are removed. T remains the configurable shell-follow shortcut. Binocular
mode hides smoke emitted at the player's ship, including already active smoke, while it continues
aging; other ships' smoke remains visible.

Local structural damage appears in Gunnery's Damaged sections list and beside the affected shell
impact. Labels explain reduced hull damage and intact equipment reached through wreckage. Combat
inspection adds amber outlines for damaged structural regions and grey outlines for depleted
regions; orange compartment fill marks active fires. These overlays are separate from equipment
condition and blue floodwater.

Damage control is the ship's own state, so it rides on the ship card instead of the battle corner:
one 11 px line above the ship name reading Damage control and the crew priority, which turns amber
and names the burning space and the crews at work. Its panel opens beside the card, 28 px to its
right and bottom-aligned, below the horizon where no ship tag projects; at widths up to 1150 px it
rises above the card instead. The panel has no fill, only hairline rules above and below, and sets
crew priority with a four-way switch (Auto, Fires, Flooding, Repairs) whose selection is mint. Own
damage control puts active fires first, showing the affected space,
growing/contained/being-fought/cooling status, remaining fuel and threatened equipment. Each row
offers Focus crews. Target fires have the same readings without crew commands. Electrical supply and
fire-control availability appear beside existing condition readings. Keep these additions within the
scrolling naval instrument; room smoke exits above the deck and stays bounded with the existing
gunhouse fire effects.

Enemy impact labels sit just above their recorded hit positions, following the displayed hull.
Damage gold leads with actual hull HP lost; the part name and impact outcome sit below. Zero-HP
armor rejection uses muted text. Combine shell layers and nearby hits on one part, prioritize
equipment damage, avoid overlapping labels, and cap the group at twelve. Labels hold for 2.4 seconds
and fade over 0.8 seconds of simulation time; pause freezes them.
