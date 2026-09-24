# Layout: instrument positions, sizes and responsive breakpoints

Moved verbatim from [DESIGN.md](../../DESIGN.md) on 2026-09-19 (rewrapped, relative links adjusted).
DESIGN.md keeps the tokens and rules; this file keeps the detail and rationale.

## Layout

Fleet action keeps ship status and handling at lower left (240 px wide), armament at bottom center
(340 px wide), a view-bearing tape at top center, and a fixed sight at the exact viewport center.
The compact helm uses a 156 px bearing dial; armament uses 64 px weapon slots and 30 px readiness
rings. The standard instrument insets use the Fleet edge and bottom spacing tokens. The upper-left
scene stays clear of mission text and forms: a battle shows only its tally there, 300 px wide and
one glance tall. The tally is the clock in 30 px condensed figures, one 5 px gauge per hull on
either side (mint friendly, salmon enemy, 18 px tall for a battleship or carrier and 13 px
otherwise, filled to the hull left, gold below half and dashed when lost), a 4 px balance bar split
by tonnage afloat, and both tonnages in whole tonnes. Below it a Fleet chart command with its
keycap, and a Ctrl · Roster hint while the cursor is captured. A free cursor (Ctrl held, or before
the sea is clicked) unfolds the roster under the tally: class code, name, the captain's order in a
word, a 44 px hull bar and the percentage; enemy rows designate the target. In a fleet of more than
ten hulls any class of more than four folds into one line until it is opened. Fleet orders are given
on the fleet chart, never typed into this corner. The quiet FPS counter sits at upper right,
right-aligned on the Fleet edge; the Damage / Frags reading sits below it. Gunnery details open
beneath the score at 108 px from the top (100 px at widths up to 600 px, or 88 px in short
landscape) and scroll within the available height.

The transparent square minimap sits flush with the bottom and right viewport edges. Its five nominal
desktop sizes are 240, 280, 320, 360 and 400 px, with 320 px selected initially. Available space
sets the largest size to the minimum of 400 px, 31 vw and 68 vh; every size applies its own
proportional factor (60%, 70%, 80%, 90% or 100%) to that limit. This keeps all five steps distinct
when the viewport constrains the map. The map has no camera toolbar above it.

At widths up to 1150 px, Fleet action narrows the handling and armament groups to 208 and 296 px and
reduces side insets to 18 px. Between 601 and 900 px, they narrow to 180 and 260 px with 12 px side
and 14 px bottom insets. At 600 px and below, the armament group is at most 310 px wide and moves
below the top compass (150 px from the top), leaving room for the compact damage log and keeping the
central sight clear; the handling group remains at lower left with a 100 px bearing dial, and map
sizes step from 30 to 50 vw. Short landscape viewports (620 px high or less, wider than 600 px) hide
the mount-reload row and battery heading, reduce weapon slots to 48 px high with 38 px ammunition
illustrations, retain weapon keycaps and bottom clearance, and move gunnery details upward; gun
marks remain in the helm compass and full mount status remains available through G.

Ships fitted with depth charges expand the armament group to 440 px for four weapon choices plus
binoculars, gunnery and the firing action. Between 601 and 900 px, this expanded group fills the
space between the helm and chart: its left edge is 204 px from the viewport, with 12 px clearance
from the chart. Four weapon buttons occupy the first row; binoculars, gunnery and a two-column
firing action occupy the second, with a 26 px row gap preserving keycaps. This arrangement also
applies in short landscape, where the release help remains visible. At 600 px and below, the
expanded group retains the upper position and uses the viewport width minus 24 px, capped at 380 px,
with 4 px gaps between its seven controls. Keep readiness and weapon help adjacent to the controls
while preserving the central sight.

The submarine depth instrument sits above the lower-left helm on desktop, sharing its 240 px width
and narrowing to 200 px between 601 and 1100 px. At 600 px and below it moves to a narrow right
column, with wrapped readings and hidden keyboard hints; the mouse-capture prompt moves above it.
Short landscape moves depth to the upper right. These placements keep the centered sight, hull and
sea visible while depth orders remain reachable.

The home port berths only the player's own designs, one ship at a time (owner-selected study D,
“Builder's plate”, with the plan chest of study C as its library). The brass Battle command stays
centered horizontally in the transparent top bar, with a caret that opens a mode menu and a small
“Last” reading beneath it; the account button and FPS reading sit at its left, and an outlined-brass
New design with the All designs count at its right. The ship's builder's plate hangs at lower left,
56 px in and 86 px up: a mint Ready for sea mark with the edit time, the name in 600-weight
condensed type scaled between 34 and 64 px by viewport width and height, a hairline-ruled row of
Length, Beam, Draft, Displacement, Speed and Main battery in 21 px condensed figures under 9.5 px
capital labels, then a 40 px Edit design as an outlined brass command with Delete beside it. The
port camera lowers its aim by a fixed share of the orbit distance, so the ship rides in the clear
upper half above the plate at every zoom. It handles like the shipbuilder's camera: drag orbits,
below the waterline as freely as above it; right-drag or a Shift/Ctrl/⌘-drag trucks the view in the
screen plane so the hull follows the pointer, with no reach limit and no floor at the surface (only
the harbor's land stays solid); scroll zooms between 20 m and 1,200 m per 250 m of hull, with the
near plane shortening up close; and double-click or the recenter key restores the opening pan, orbit
and zoom, which is the way back from anywhere; a bottom-weighted shade replaces the side vignette.
At right, the particulars column (320 px, from under the top bar to the fleet line) never moves:
Overview, Armor, Equipment and Flooding tabs over one scrolling body, with an isolation line and an
explanation line pinned at its foot. It rests on a light right-edge shade that fades in below the
top bar, not on a card. Side arrows 48 × 96 px at the vertical middle name the previous and next
ready design and ← / → do the same; the next-design arrow stands just left of the column. The fleet
line along the bottom centers up to seven 96 px thumbnail renders around the berthed ship (brass
underline when selected, half opacity otherwise) between ← → keycaps, ending in an All N entry to
the plan chest. Solid brass remains reserved for Battle.

Battle setup is one full-screen board for every mode. The 52 px top bar holds the title, brass mode
tabs (Custom battle, Fleet command, 1v1 online), a one-line mode summary and the close control. The
board is three columns: a 296 px ship catalog, drop lanes in the middle and a 304 px settings rail;
a 64 px footer carries the compass briefing, the status line and the Back / primary actions. Ship
cards use one anatomy in every size: a dotted grip, the silhouette thumbnail, the name in 15 px
condensed type, then the class silhouette icon with the detailed type, a 15 × 10 px simplified civil
flag with the nation, and brass aircraft counts for carriers. Lanes tint their headings mint
(friendly) and salmon (enemy), show a dashed drop hint at the bottom that turns mint while a ship is
picked or dragged, and outline the commanded ship’s berth in brass. Allowance meters use mint fills
and turn salmon when exceeded. The deployment chart draws each group as a dashed frame with an
upper-left name tag, a brass compass ring with 15° ticks and a bow-shaped handle around the
selection, and a brass heading readout; the side rail repeats the ring as a 72 px heading dial.
The chart draws the real coast with shaded relief bands, keeps the map's frame ("315° up" beside
the rail title), and turns its N and the ring's letters and heavy ticks to true north, so the heading
readout, dial and input read true. Until the coast has loaded the status line reads "Charting the
coast…" and Start waits.
Selection scope (Group / Ship) is a segmented control with G and S keycaps.

The column narrows to 296 px at 1,240 px and 272 px at 980 px, lifts clear of the fleet line below
1,180 px and starts at 90 px on short screens; the builder's plate keeps to its left. Below 600 px
it becomes a sheet along the bottom (at most 44 % of the height), the plate keeps its name and
actions above it, and the explanation line is dropped. Narrow and short layouts rearrange
instruments without a scaled virtual canvas; coarse pointers expose steering buttons.

**The Clear Center Rule.** Keep the ship and sea visible, with instruments anchored at the viewport
edges.
