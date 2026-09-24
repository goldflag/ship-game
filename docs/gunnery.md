# Gunnery: from the sight to the circle

How a surface gun's aim travels from the player's sight through the Rust simulation and back to the
circles drawn on the screen. Read this before changing aiming, gun laying, the gun-aim circles or the
flight-time readout. Bots aim through the same mount code with their own aim point; see
[bot behavior](bot-behavior.md).

Units throughout: world metres, y up, bow toward −z (`meters-y-up-bow-negative-z`); angles in radians;
seconds. The simulation ticks at 60 Hz (`rules::TICK_RATE`, `DT` = 1/60 s). Ship state stays physical;
the world moves ships `SHIP_PACE` (1.5) times as far, and shells fly `SHELL_PACE` (1.25) physical
seconds per battle second (`crates/naval-sim/src/mobility.rs`, mirrored in `src/ships/mobility.ts`).

## The path

| Step | Code | Runs | What it does |
| --- | --- | --- | --- |
| 1. Sight | `src/game/Game.ts` `readSightAim`, `src/game/aiming.ts` `sightAim` | Every render frame | Casts the camera's centre ray against enemy hulls' CPU armor and structure, else returns a sea point |
| 1a. Auto aim | `src/game/session/telemetry.ts` `presentationAim` | Every render frame, after a target is selected until the mouse moves | Leads the selected target (or a chosen module) for the selected battery's muzzle speed |
| 2. Intent | `SnapshotSession.input` (`src/game/session/SnapshotSession.ts`) | Local: with every worker batch; online: at most every 50 ms | Sends an `input` command: aim point, fire, battery, weapon group, ammunition, helm |
| 3. Orders | `crates/naval-protocol/src/session.rs` `Session::step`, `lib.rs` `HeldInput` | Every tick | Validates the input and turns it into `PlayerGunOrders` on the ship's standing `Orders` |
| 4. Gun control | `crates/naval-sim/src/gunnery.rs` `operate_cadenced` | Every 6 ticks (`SURFACE_CONTROL_TICKS`, 10 Hz); reload and recoil every tick | Hands every surface mount the player's aim; fires the selected group |
| 5. Laying | `crates/naval-sim/src/weapons.rs` `update_mount_control_at` | Each control update | Solves the lead, lays train and elevation in the rolled hull frame, sets the mount status |
| 6. Hull attitude | `crates/naval-sim/src/stability.rs` `update_stability`, `environment.rs` `SeaState::response` | Every tick | Roll and pitch from the righting arms plus the wave arm |
| 7. Frames | `ShipView.updateMotion` / `updateArticulation` (`src/game/ShipView.ts`) | Every render frame | Interpolates pose, train and elevation between the last two frames by `interpolationAlpha` |
| 8. Preview | `src/game/gunAim.ts` `gunAimPoints` | Every render frame | Traces each selected gun's current barrels forward to the aim range, or to where the round meets the sea |
| 9. Circles | `src/game/GunAimIndicators.ts` | Every render frame | Projects, smooths (80 ms), groups and labels the preview points |

### 1. The sight

`readSightAim` returns the rangefinder's locked point (`rig.rangeAim`) for guns when one is set, and
otherwise calls `sightAim(camera position, camera direction, targets)`. The targets are the other
actors above −40 m, at their latest snapshot poses (`simulation.actors`, not the interpolated views),
with their CPU armor, structure and current turret trains. The first hit is the aim point.

A ray that hits nothing ends on the plane y = 0.5 m: where the ray meets it if that is within 30 km
(`MAX_AIM_DISTANCE`), otherwise the point 30 km along the ray dropped to y = 0.5. A level or rising
ray therefore aims at a sea point 30 km out. The rendered ocean never chooses the aim; GPU waves are
visual only.

While the aim is locked (right mouse held), the view is away or the ship is sunk, `Game` keeps the
previous aim instead of reading the sight. Torpedo batteries convert the point to a course
(`torpedoBearingAim`, `torpedoCourseAim`); that path is not covered here.

### 2–3. Input to orders

`Game` passes `{ aim, fire, battery, weaponGroupId, ammunition }` to `session.advance` each frame.
`LocalBattleSession` keeps the latest and sends it with each worker batch (up to 24 ticks, one batch
in flight); `RemoteBattleSession` sends it at most every 50 ms, and the server publishes frames at
most every 50 ms. The command is `Command::Input { input: HeldInput }` in `naval-protocol`, rejected
unless every aim coordinate is finite and within ±40 km.

`Session::step` builds `PlayerGunOrders { battery, weapon_group_id, aim, fire, ammunition }` for the
ship the player has selected. A held input expires 500 ms after it arrived (`heldInputTimeoutMs` in
`assets/gameplay/battle-rules.v1.json`); after that `aim` is `None`.

### 4. Gun control at 10 Hz

`Battle::fight` calls `gunnery::operate_cadenced` every tick with `surface_update` true on every
sixth. Between updates only the mount clock (reload, recoil) advances; automatic weapons that reload
in under 0.1 s run every tick. A fire press between updates is latched (`surface_fire`) and used at
the next one.

With player orders every surface-capable mount, selected or not, lays on the player's aim; only the
selected battery or group fires. Mounts outside the selected weapon group first try automatic AA. A
missing aim sets `MountStatus::OutOfArc` and skips the mount.

### 5. Laying the mount

`update_mount_control_at` solves the lead from the muzzle midpoint at the desired train and
elevation (three iterations, or one when the aim moved less than 10 m and a cached solution exists):
the aim point minus the ship's inherited velocity (world velocity / `SHELL_PACE`) over the drag
travel factor, through `solve_ballistic` (no solution beyond 30 km horizontal, or beyond the muzzle
speed's reach). The resulting direction is taken into the hull frame through the ship's full
attitude (`ShipState::basis`: heading, pitch and roll), so train and elevation are hull-relative and
the gun re-lays against roll at every control update.

Train is clamped to the traverse limits and elevation to the mount's elevation limits, then moved at
the traverse and elevation rates × the control interval × the electrical work rate (guns of 203 mm
and more traverse at least 7°/s). Mount clearance can stop the move. The status is the first of these that applies:

| Status | Meaning |
| --- | --- |
| `disabled`, `empty`, `submerged` | Mount destroyed, not enough loaded rounds for a salvo, muzzle under water |
| `blocked` | Mount clearance stopped the move |
| `turning` | A reachable in-arc solution the mount has not reached (0.0015 rad train, 0.0008 rad elevation) |
| `reloading` | On the solution, still loading |
| `blocked` | The bore line crosses an obstruction |
| `out-of-range` | `solve_ballistic` found no arc |
| `out-of-arc` | The arc needs a train or an elevation outside the mount's limits |
| `ready` | On the solution, loaded, clear |

### Rest and idle secondaries

Where a gun points when nothing is aimed. One rule covers every preset and player design, from data
each mount already has (`crates/naval-sim/src/mount_rest.rs`):

- A **side secondary** rests trained toward the nearer end of the ship: the bow when it sits at or
  forward of the hull's longitudinal middle (the middle of the collision outline's z extent), the
  stern abaft it. A side secondary is a `secondary`-battery mount over 80 mm (lighter guns are light
  AA, the same line as `anti_aircraft::surface_allowed`), on the hull (no `parentMountId`) and more
  than 0.5 m off the centreline.
- The rest is a train relative to `bearingDeg`, clamped to the installed limits (`traverseLimitsDeg`,
  else ± the installed half-sector); `bearingDeg` stays the arc centre. King George V's 5.25-inch
  turrets (±80° about the beam) rest 10° off the bow or stern. Mounts already authored facing their
  end (the wing 5-inch of Alaska and Cleveland, Hipper's 10.5 cm) rest at neutral.
- `CompiledShip::new` solves each rest once, training the mount from neutral toward it after the
  mounts before it took theirs: through the swept-body resolver or installation envelope where the
  mount has one, otherwise stopping before its barrels (breech to muzzle) first enter the hull, an
  authored obstruction or another gunhouse. Baltimore's forward wing mounts stop at 141° off the bow,
  short of the after pair's gunhouses.
- `Vessel::new` starts every spawn, trial reset and the port (whose session is never stepped) at the
  rests, so nothing slews on the first frame.
- In battle, a side secondary with no aim (no target within its gun range, no contact for a PvE
  secondary battery, no aircraft for AA) holds for `IDLE_REST_SECONDS` (5 s), then trains back to its
  rest train and spawn elevation at its normal traverse and elevation rates. Any surface or air aim
  resets the count. Its status is what any aimless mount reports: `out-of-range`, or `blocked` when
  the bore line crosses the ship, as it often does when trained along her.
- Main battery, light AA, carried and centreline mounts rest at neutral and still hold their last
  aim when idle. The player's own ship lays every surface mount on the sight (step 4), so its
  secondaries leave their rests as soon as input arrives.

A bot's secondaries therefore open an engagement from their rests: a slow narrow-arc mount such as
King George V's (10°/s) needs about 8 s to reach the beam.

### 6. Roll

Every tick, `update_stability` integrates roll and pitch rates from the hydrostatic righting arms
plus a wave arm: `SeaState::response` takes the wave-height slope across 80% of the beam (±0.18 rad)
and a turn heel (speed × yaw rate / g × 0.3, ±0.06 rad), and `WAVE_ROLL_LEVER` scales it into the roll
arm. Floodwater moves the centre of gravity those arms use, which is how flooding lists the ship. The tick order is observe, decide, manoeuvre,
fight, strike, suffer, settle, so the guns lay against the attitude left by the previous tick.

### 7–9. Back on the screen

Each frame carries every mount's `train`, `elevation`, `status`, `reload` and `aimCache` (solved train, elevation and shell time).
`ShipView` interpolates pose, train, elevation and recoil between the previous and current frame by
`interpolationAlpha` (elapsed / frame interval), so what is drawn trails the authoritative tick by up
to one frame interval.

`gunAimPoints` is a preview, not the simulation's aim. For each selected surface gun it takes the
interpolated barrels (`shotDirection` of the rendered mount state), the muzzle speed plus the ship's
velocity / `SHELL_PACE`, and traces the drag ballistic to the aim point's horizontal range, or
bisects to where the round meets the sea if it falls short. The circle therefore shows where the
barrels point now; it converges on the sight as the mount trains. `aligned` is `ready` or
`reloading`.

`GunAimIndicators` projects each point, smooths its direction in camera space with an 80 ms time
constant (95% in 240 ms), groups turrets within 24 px that share state and reload seconds, and turns
points behind the camera, or beyond 88% of the half-width or 76% of the half-height, into edge arrows. The label lists the turret
numbers and the state. The flight-time readout (`presentationTelemetry`) averages `aimCache.time /
SHELL_PACE` over the selected guns that are ready, reloading or turning.

## Aim circle states

| Circle class | Label | From |
| --- | --- | --- |
| `gun-aim-aligned` | On aim | `ready` |
| `gun-aim-reloading` | On aim · Reload N s | `reloading` |
| `gun-aim-turning` | Turning (· Reload N s) | any status not listed below, while not aligned |
| `gun-aim-out-of-arc` | Out of arc | `out-of-arc` |
| `gun-aim-out-of-range` | Out of range | `out-of-range` |
| `gun-aim-blocked`, `-empty`, `-disabled`, `-submerged` | Blocked, Empty, Disabled, Submerged | the same statuses |

**Out of arc and out of range look identical.** `src/ui/GunAimIndicators.css` gives both the same
grey (`#c1d0d4`, also the reloading colour) and the same diagonal strike; only the label differs.
Read the label, or the mount status in a frame, before deciding which one you are looking at.

## Traps

- `out-of-arc` is not only a bearing problem. A target beyond the range the gun reaches at its
  maximum elevation has a ballistic solution but needs more elevation than the mount allows, so it
  reports out of arc, not out of range. Elevation limits are relative to the deck: heeling toward the
  target raises the elevation the gun needs, so near maximum range the status can change as the ship
  rolls.
- An expired held input (online, 500 ms without a new one) leaves the ship with no aim, and every
  surface mount reports out of arc.
- The sight tests the latest snapshot's hull poses, while the camera and the ships are drawn at the
  interpolated pose. The two differ by at most one frame interval of motion.
- The preview uses the rendered, interpolated mount angles and the aim point's range. It is not the
  lead the simulation solved: for that, read the mount's `aimCache` (the solved train, elevation and shell time).
- Local and online sessions run the same Rust code, so a circle that differs between them is a
  difference in input timing or frame interpolation, not in the solver.
